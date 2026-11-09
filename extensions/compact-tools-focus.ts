/**
 * Pure helpers for Focus-style request grouping.
 *
 * This module deliberately has no runtime imports so its grouping and count
 * logic can be tested without loading Pi or the terminal UI.
 */

export interface FocusRow {
	toolName: string;
	args?: unknown;
	result?: { isError?: boolean } | undefined;
}

export interface FocusCounts {
	total: number;
	reads: number;
	searches: number;
	commands: number;
	edits: number;
	failed: number;
}

export interface FocusChildClassifier<T> {
	isTool(child: T): boolean;
	isUser(child: T): boolean;
	isAssistant(child: T): boolean;
	isThinkingOnly(child: T): boolean;
	isFoldable(child: T): boolean;
}

function pathArgument(args: unknown): string | undefined {
	if (!args || typeof args !== "object") return undefined;
	const record = args as Record<string, unknown>;
	for (const key of ["path", "file_path", "filePath", "file"]) {
		const value = record[key];
		if (typeof value === "string" && value.trim()) return value;
	}
	return undefined;
}

function baseName(name: string): string {
	return name.split(".").pop() ?? name;
}

/** Counts the categories shown by a collapsed Focus group. */
export function focusCounts(rows: readonly FocusRow[]): FocusCounts {
	const counts: FocusCounts = { total: rows.length, reads: 0, searches: 0, commands: 0, edits: 0, failed: 0 };
	const readPaths = new Set<string>();
	const changedPaths = new Set<string>();
	let readsWithoutPath = 0;
	let editsWithoutPath = 0;

	for (const row of rows) {
		const name = baseName(row.toolName);
		const path = pathArgument(row.args);
		if (name === "read") {
			if (path) readPaths.add(path);
			else readsWithoutPath++;
		} else if (name === "grep" || name === "find" || name === "ls") {
			counts.searches++;
		} else if (name === "bash" || name === "powershell") {
			counts.commands++;
		} else if (name === "edit" || name === "write") {
			if (path) changedPaths.add(path);
			else editsWithoutPath++;
		}
		if (row.result?.isError) counts.failed++;
	}

	counts.reads = readPaths.size + readsWithoutPath;
	counts.edits = changedPaths.size + editsWithoutPath;
	return counts;
}

/** The exact plain text used by a collapsed Focus group. */
export function focusSummaryText(counts: FocusCounts): string {
	const parts = [`${counts.total} ${counts.total === 1 ? "tool call" : "tool calls"}`];
	if (counts.reads) parts.push(`read ${counts.reads}`);
	if (counts.searches) parts.push(`searched ${counts.searches}`);
	if (counts.commands) parts.push(`ran ${counts.commands} ${counts.commands === 1 ? "shell command" : "shell commands"}`);
	if (counts.edits) parts.push(`edited ${counts.edits}`);
	parts.push(`${counts.failed} failed`);
	return parts.join(" · ");
}

/**
 * Fold every tool row in one user request into one group.
 *
 * User prompts end the previous request. Thinking-only assistant components
 * are group members and disappear while the group is collapsed. Literal
 * intermediate prose stays visible, as does the final answer.
 */
export function groupFocusChildren<T>(
	children: readonly T[],
	makeGroup: (rows: T[], members: T[], visible: T[]) => T,
	classify: FocusChildClassifier<T>,
): T[] {
	const grouped: T[] = [];
	let rows: T[] = [];
	let members: T[] = [];
	let pending: T[] = [];
	let visible: T[] = [];

	// Each user prompt starts a request segment. The last assistant component in
	// a segment is its final answer; earlier assistant components are literal
	// intermediate prose and remain visible.
	const lastAssistantBySegment = new Map<number, number>();
	let segment = 0;
	let segmentStart = 0;
	for (let index = 0; index < children.length; index++) {
		if (!classify.isUser(children[index]!)) continue;
		for (let candidate = segmentStart; candidate < index; candidate++) {
			if (classify.isAssistant(children[candidate]!)) lastAssistantBySegment.set(segment, candidate);
		}
		segment++;
		segmentStart = index + 1;
	}
	for (let candidate = segmentStart; candidate < children.length; candidate++) {
		if (classify.isAssistant(children[candidate]!)) lastAssistantBySegment.set(segment, candidate);
	}

	const flush = (): boolean => {
		if (rows.length === 0) return false;
		members.push(...pending);
		pending = [];
		grouped.push(makeGroup(rows, members, visible));
		rows = [];
		members = [];
		visible = [];
		return true;
	};

	let currentSegment = 0;
	for (let index = 0; index < children.length; index++) {
		const child = children[index]!;
		if (classify.isUser(child)) {
			if (!flush()) grouped.push(...visible);
			visible = [];
			grouped.push(...pending, child);
			pending = [];
			currentSegment++;
			continue;
		}
		if (classify.isTool(child)) {
			members.push(...pending, child);
			pending = [];
			rows.push(child);
			continue;
		}
		if (classify.isAssistant(child)) {
			if (classify.isThinkingOnly(child)) {
				pending.push(child);
				continue;
			}
			const finalAssistant = lastAssistantBySegment.get(currentSegment) === index;
			if (!finalAssistant) {
				visible.push(child);
				continue;
			}
			if (!flush()) grouped.push(...visible);
			visible = [];
			grouped.push(...pending, child);
			pending = [];
			continue;
		}
		if (classify.isFoldable(child)) {
			pending.push(child);
			continue;
		}
		if (!flush()) grouped.push(...visible);
		visible = [];
		grouped.push(...pending, child);
		pending = [];
	}

	if (!flush()) grouped.push(...visible);
	visible = [];
	grouped.push(...pending);
	return grouped;
}

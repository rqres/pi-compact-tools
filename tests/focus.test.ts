/**
 * Focus style: one category-aware group per request. Covers the pure grouping
 * and count helpers in compact-tools-focus.ts (no Pi runtime needed).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { focusCounts, focusSummaryText, groupFocusChildren } from "../extensions/compact-tools-focus.ts";

test("focus counts and summary text, and request grouping", () => {
	const rows = [
		{ toolName: "read", args: { path: "src/a.ts" }, result: { isError: false } },
		{ toolName: "read", args: { path: "src/a.ts" }, result: { isError: false } },
		{ toolName: "grep", args: { pattern: "todo" }, result: { isError: false } },
		{ toolName: "bash", args: { command: "npm test" }, result: { isError: false } },
		{ toolName: "edit", args: { path: "src/b.ts" }, result: { isError: false } },
		{ toolName: "write", args: { path: "src/b.ts" }, result: { isError: true } },
	];
	const counts = focusCounts(rows);
	assert.deepEqual(counts, {
		total: 6,
		reads: 1,
		searches: 1,
		commands: 1,
		edits: 1,
		failed: 1,
	});
	assert.equal(
		focusSummaryText(counts),
		"6 tool calls · read 1 · searched 1 · ran 1 shell command · edited 1 · 1 failed",
	);
	
	type Child = { kind: string; id?: string; thinking?: boolean; rows?: Child[]; members?: Child[]; visible?: Child[] };
	const children: Child[] = [
		{ kind: "user", id: "prompt-1" },
		{ kind: "tool", id: "tool-1" },
		{ kind: "assistant", id: "intermediate-1", thinking: true },
		{ kind: "text", id: "status-1" },
		{ kind: "assistant", id: "prose-1", thinking: false },
		{ kind: "tool", id: "tool-2" },
		{ kind: "assistant", id: "final-1", thinking: false },
		{ kind: "user", id: "prompt-2" },
		{ kind: "tool", id: "tool-3" },
	];
	const grouped = groupFocusChildren<Child>(
		children,
		(groupRows, members, visible): Child => ({ kind: "group", rows: groupRows, members, visible }),
		{
			isTool: (child) => child.kind === "tool",
			isUser: (child) => child.kind === "user",
			isAssistant: (child) => child.kind === "assistant",
			isThinkingOnly: (child) => child.kind === "assistant" && child.thinking === true,
			isFoldable: (child) => child.kind === "text" || child.kind === "spacer",
		},
	);
	
	assert.equal(grouped.length, 5);
	assert.equal(grouped[0]!.kind, "user");
	assert.equal(grouped[0]!.id, "prompt-1");
	assert.equal(grouped[1]!.kind, "group");
	assert.deepEqual(grouped[1]!.rows!.map((row: Child) => row.id), ["tool-1", "tool-2"]);
	assert.deepEqual(grouped[1]!.members!.map((member: Child) => member.id), ["tool-1", "intermediate-1", "status-1", "tool-2"]);
	assert.deepEqual(grouped[1]!.visible!.map((member: Child) => member.id), ["prose-1"]);
	assert.equal(grouped[2]!.kind, "assistant");
	assert.equal(grouped[2]!.id, "final-1");
	assert.equal(grouped[3]!.kind, "user");
	assert.equal(grouped[3]!.id, "prompt-2");
	assert.equal(grouped[4]!.kind, "group");
	assert.deepEqual(grouped[4]!.rows!.map((row: Child) => row.id), ["tool-3"]);
});

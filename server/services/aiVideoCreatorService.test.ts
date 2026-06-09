import { describe, it, expect } from "vitest";
import { applyPlanDiff } from "./aiVideoCreatorService";

const basePlan = {
  title: "原标题",
  script: "原脚本全文",
  muteOriginal: false,
  clips: [
    { videoIndex: 0, startTime: 0, endTime: 2, narration: "开头" },
    { videoIndex: 1, startTime: 2, endTime: 5, narration: "中段" },
    { videoIndex: 2, startTime: 5, endTime: 8, narration: "结尾" },
  ],
};

describe("applyPlanDiff", () => {
  it("空操作返回等价方案", () => {
    const r = applyPlanDiff(basePlan as any, { operations: [] });
    expect(r.clips).toHaveLength(3);
    expect(r.title).toBe("原标题");
  });

  it("modify_narration 只改指定片段的配音", () => {
    const r = applyPlanDiff(basePlan as any, {
      operations: [{ op: "modify_narration", index: 0, narration: "全新开场白" }],
    });
    expect(r.clips[0].narration).toBe("全新开场白");
    expect(r.clips[1].narration).toBe("中段"); // 其余不动
    expect(r.clips[2].narration).toBe("结尾");
  });

  it("replace_clip 部分覆盖字段，保留未提供字段", () => {
    const r = applyPlanDiff(basePlan as any, {
      operations: [{ op: "replace_clip", index: 1, clip: { startTime: 3, endTime: 6 } }],
    });
    expect(r.clips[1].startTime).toBe(3);
    expect(r.clips[1].endTime).toBe(6);
    expect(r.clips[1].videoIndex).toBe(1); // 未提供 → 保留
    expect(r.clips[1].narration).toBe("中段");
  });

  it("delete_clip 删除指定片段", () => {
    const r = applyPlanDiff(basePlan as any, {
      operations: [{ op: "delete_clip", index: 1 }],
    });
    expect(r.clips).toHaveLength(2);
    expect(r.clips.map((c) => c.narration)).toEqual(["开头", "结尾"]);
  });

  it("insert_clip 在指定下标后插入", () => {
    const r = applyPlanDiff(basePlan as any, {
      operations: [
        { op: "insert_clip", afterIndex: 0, clip: { videoIndex: 3, startTime: 0, endTime: 1, narration: "新插入" } },
      ],
    });
    expect(r.clips).toHaveLength(4);
    expect(r.clips[1].narration).toBe("新插入");
  });

  it("非法 index 的操作被安全跳过，不影响其余", () => {
    const r = applyPlanDiff(basePlan as any, {
      operations: [
        { op: "modify_narration", index: 99, narration: "越界" },
        { op: "modify_narration", index: 2, narration: "合法修改" },
      ],
    });
    expect(r.clips).toHaveLength(3);
    expect(r.clips[2].narration).toBe("合法修改");
  });

  it("全删空时兜底退回原方案，不产出空时间轴", () => {
    const r = applyPlanDiff(basePlan as any, {
      operations: [
        { op: "delete_clip", index: 0 },
        { op: "delete_clip", index: 1 },
        { op: "delete_clip", index: 2 },
      ],
    });
    expect(r.clips.length).toBeGreaterThan(0);
  });

  it("set_title / set_mute 改方案级字段", () => {
    const r = applyPlanDiff(basePlan as any, {
      operations: [
        { op: "set_title", title: "新标题" },
        { op: "set_mute", muteOriginal: true },
      ],
    });
    expect(r.title).toBe("新标题");
    expect(r.muteOriginal).toBe(true);
  });

  it("change_transition 改片段转场", () => {
    const r = applyPlanDiff(basePlan as any, {
      operations: [{ op: "change_transition", index: 1, transition: "dissolve" as any, transitionDuration: 0.6 }],
    });
    expect(r.clips[1].transition).toBe("dissolve");
    expect(r.clips[1].transitionDuration).toBe(0.6);
  });

  it("删除 + 插入组合，下标按原始方案计算不漂移", () => {
    const r = applyPlanDiff(basePlan as any, {
      operations: [
        { op: "delete_clip", index: 0 },
        { op: "insert_clip", afterIndex: 1, clip: { videoIndex: 4, startTime: 0, endTime: 1, narration: "X" } },
      ],
    });
    // 删掉"开头"，在原#1之后插入X → [中段, X, 结尾]
    expect(r.clips.map((c) => c.narration)).toEqual(["中段", "X", "结尾"]);
  });
});

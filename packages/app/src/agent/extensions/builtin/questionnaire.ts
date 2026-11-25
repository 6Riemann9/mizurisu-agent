import type { AgentTool } from "@earendil-works/pi-agent-core";
import { arr, bool, obj, opt, str } from "@earendil-works/pi-schema";
import type { QuestionnaireQuestion } from "../../../types";
import type { ExtensionRuntimeContext, MizurisuExtension } from "../types";

const questionnaireParams = obj({
  title: opt(str({ description: "弹窗标题，例如：确认演示文稿制作偏好" })),
  questions: arr(
    obj({
      id: str({ description: "问题唯一 ID" }),
      question: str({ description: "向用户提出的问题" }),
      options: arr(str({ description: "候选选项文案" }), {
        minItems: 2,
        description: "至少 2 个明确选项",
      }),
      multiSelect: opt(bool({ description: "是否允许多选，默认 false（单选）" })),
    }),
    { minItems: 1, maxItems: 4, description: "1 至 4 道结构化选择题" }
  ),
});

export const questionnaireExtension: MizurisuExtension = {
  id: "pi-questionnaire",
  name: "交互式需求反问 (Questionnaire)",
  description: "当用户需求模糊（如受众、模板风格、统计口径）时弹出多题点选卡片，大幅提升一次成稿率。",
  category: "workflow",
  defaultEnabled: true,
  register(api, runtimeCtx?: ExtensionRuntimeContext) {
    // 子代理或无交互界面回调时不暴露此阻塞弹窗工具
    if (runtimeCtx && (runtimeCtx.subagentDepth > 0 || !runtimeCtx.requestQuestionnaire)) {
      return;
    }

    const askQuestionsTool: AgentTool<typeof questionnaireParams> = {
      name: "ask_user_questions",
      label: "向用户发起选择确认",
      description:
        "当用户指令缺少关键偏好（如 PPT 风格、目标受众、输出格式或口径选择）时，弹出最多 4 道单选/多选卡片让用户一键点选（不要用于简单常识）。",
      parameters: questionnaireParams,
      execute: async (toolCallId, params, signal) => {
        if (!runtimeCtx?.requestQuestionnaire) {
          throw new Error("当前环境不支持交互式弹窗问卷");
        }
        if (signal?.aborted) {
          throw new Error("用户已取消执行");
        }

        const questions: QuestionnaireQuestion[] = params.questions.slice(0, 4).map((q) => ({
          id: q.id,
          question: q.question,
          options: q.options,
          multiSelect: Boolean(q.multiSelect),
        }));

        const answers = await new Promise<Record<string, string[]> | null>((resolve) => {
          let settled = false;
          const cleanup = () => {
            signal?.removeEventListener("abort", onAbort);
          };
          const safeResolve = (value: Record<string, string[]> | null) => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(value);
          };
          const onAbort = () => {
            runtimeCtx.cancelQuestionnaire?.(toolCallId);
            safeResolve(null);
          };

          // 与 ApprovalDialog 保持一致，监听 AbortSignal 防止用户中途点击停止导致 Promise 永久挂起
          signal?.addEventListener("abort", onAbort, { once: true });
          if (signal?.aborted) {
            onAbort();
            return;
          }

          runtimeCtx.requestQuestionnaire?.({
            id: toolCallId,
            sessionId: runtimeCtx.sessionId,
            title: params.title?.trim() || "请补充确认以下细节",
            questions,
            resolve: safeResolve,
          });
        });

        if (!answers) {
          return {
            content: [
              {
                type: "text",
                text: "用户取消或跳过了本次问卷确认，请按通用稳妥默认值继续或礼貌询问用户补充要求。",
              },
            ],
            details: { cancelled: true },
          };
        }

        const formatted = questions
          .map((q) => {
            const picked = answers[q.id] || [];
            return `- ${q.question}：${picked.length > 0 ? picked.join("、") : "（未选择）"}`;
          })
          .join("\n");

        return {
          content: [
            {
              type: "text",
              text: `用户已提交确认结果：\n${formatted}`,
            },
          ],
          details: { answers },
        };
      },
    };

    api.registerTool(askQuestionsTool);
    api.injectSystemPrompt(
      "- 当用户要求“做一份 PPT / 写一份报告”却未明确受众、篇幅、风格或核心口径时，可先调用 `ask_user_questions` 弹出点选卡片，避免盲目返工。"
    );
  },
};

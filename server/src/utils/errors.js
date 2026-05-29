// 文件职责：
// 统一后端 JSON 错误响应和 SSE 错误事件的数据结构。

export const ERROR_CODES = {
  INVALID_JSON: "INVALID_JSON",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  NOT_FOUND: "NOT_FOUND",
  MODEL_ERROR: "MODEL_ERROR",
  INTERNAL_ERROR: "INTERNAL_ERROR"
};

export function buildError(code, message, details = undefined) {
  return {
    error: {
      code,
      message,
      ...(details ? { details } : {})
    }
  };
}

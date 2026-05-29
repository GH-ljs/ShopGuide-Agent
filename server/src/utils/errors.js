// 文件职责：
// 错误结构工具：统一普通 JSON API 和 SSE error 事件使用的错误码与响应格式。
// 让客户端可以稳定识别 INVALID_JSON、VALIDATION_ERROR、NOT_FOUND、MODEL_ERROR 等错误类型。

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

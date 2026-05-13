import OpenAI from "openai";
import { ENV } from "./env";

let _deepseek: OpenAI | null = null;

export function getDeepSeek(): OpenAI {
  if (!_deepseek) {
    if (!ENV.deepseekApiKey) {
      throw new Error("未配置 DEEPSEEK_API_KEY，请在 .env 中设置");
    }
    _deepseek = new OpenAI({
      apiKey: ENV.deepseekApiKey,
      baseURL: ENV.deepseekBaseUrl,
      timeout: 60000,       // 60 秒超时，避免无限等待
      maxRetries: 1,        // 失败重试 1 次
    });
  }
  return _deepseek;
}

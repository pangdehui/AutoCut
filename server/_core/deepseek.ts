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
    });
  }
  return _deepseek;
}

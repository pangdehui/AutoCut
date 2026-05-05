import OpenAI from "openai";
import { ENV } from "./env";

export const openai = new OpenAI({
  apiKey: ENV.openaiApiKey || undefined,
  baseURL: ENV.openaiBaseUrl || undefined,
});

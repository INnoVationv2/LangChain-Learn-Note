import {ChatOpenAI} from "@langchain/openai";
import {ApiKey, BaseURL, MODEL} from "../../tools/utils.ts";
import {initChatModel} from "langchain";

// 两种创建Model的方式
export const model =
    new ChatOpenAI({
        model: MODEL,
        apiKey: ApiKey,
        configuration: {baseURL: BaseURL},
    });

export const closeThinkingMode =
    new ChatOpenAI({
        model: MODEL,
        apiKey: ApiKey,
        configuration: {baseURL: BaseURL},
        modelKwargs: {thinking: {type: "disabled"}},
    });

const model_2 =
    await initChatModel(MODEL, {
        modelProvider: "openai",
        apiKey: ApiKey,
        configuration: {baseURL: BaseURL,},
    });



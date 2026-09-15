import 'dotenv/config';
import {ChatOpenAI} from '@langchain/openai';
import {type ContentBlock, type UsageMetadata} from "@langchain/core/messages";

function getEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing environment variable: ${name}`);
    }
    return value;
}

export const MODEL = getEnv('MODEL_ID');
export const BaseURL = getEnv('LLM_BASE_URL')
export const ApiKey = getEnv('API_KEY')

export const model = new ChatOpenAI({
    model: MODEL,
    apiKey: ApiKey,
    configuration: {
        baseURL: BaseURL,
    },
});

export const unthinkingModel = new ChatOpenAI({
    model: MODEL,
    apiKey: ApiKey,
    configuration: {baseURL: BaseURL,},
    modelKwargs: {thinking: {type: "disabled"}}
});

export function logMetadata(metadata: UsageMetadata | undefined) {
    if (!metadata) return;

    console.log([
            `   MetaData:`,
            `       input_tokens: ${metadata.input_tokens}`,
            `       output_tokens: ${metadata.output_tokens}`,
            `       total_tokens: ${metadata.total_tokens}`
        ].join('\n')
    );
}

export function logToolCall(toolCalls: Array<ContentBlock.Tools.ToolCall> | undefined) {
    if (!toolCalls || toolCalls.length === 0) return;

    const toolCall = toolCalls.at(-1)
    console.log([
            `   ToolCall:`,
            `       Tool name: ${toolCall?.name}`,
            `       Args: ${JSON.stringify(toolCall?.args)}`,
        ].join('\n')
    );
}
import 'dotenv/config';
import {ChatOpenAI} from '@langchain/openai';

function getEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing environment variable: ${name}`);
    }
    return value;
}

export const MODEL = getEnv('MODEL_ID');
export const BaseURL = getEnv('BASE_URL')
export const ApiKey = getEnv('API_KEY')

export const model = new ChatOpenAI({
    model: MODEL,
    apiKey: ApiKey,
    configuration: {
        baseURL: BaseURL,
    },
});
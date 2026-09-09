import * as z from "zod";
import {createAgent, tool, type ToolRuntime} from "langchain";
import {MemorySaver} from "@langchain/langgraph";
import {ApiKey, BaseURL, MODEL, model} from "../tools/utils.ts";
import {ChatOpenAI} from "@langchain/openai";

const UserDetailSchema = z.object({
        name: z.string(),
        age: z.number()
    }
)

const contextSchema = z.object({
    userMap: z.map(z.number(), UserDetailSchema)
});

const paramSchema = z.object({userId: z.number()})
const fn = ({userId}: z.infer<typeof paramSchema>, runtime: ToolRuntime<unknown, typeof contextSchema>) => {
    const userMap = runtime.context.userMap;
    const user = userMap.get(userId);
    if (!user) return "User does not exist";
    return `User Name:${user.name}, Age:${user.age}`;
}

const getUserDetailTool = tool(
    fn,
    {
        name: 'getUserDetail',
        description: 'Get user detail by user id',
        schema: paramSchema
    }
)

// 指定输出格式
const UserDetailFormat = z.object({name: z.string(), age: z.number()});
const agent = createAgent({
    model: new ChatOpenAI({
        model: MODEL,
        apiKey: ApiKey,
        configuration: {baseURL: BaseURL,},
        modelKwargs: {thinking: {type: "disabled"}}
    }),
    tools: [getUserDetailTool],
    contextSchema,
    checkpointer: new MemorySaver(),
    responseFormat: UserDetailFormat,
});

const config = {
    configurable: {thread_id: crypto.randomUUID()},
    context: {
        userMap: new Map([
            [1, {name: "张三", age: 88}],
            [2, {name: "李四", age: 66}],
        ])
    }
}

for (let id = 1; id <= 3; id++) {
    let result = await agent.invoke(
        {messages: [{role: "user", content: `User Id is ${id}, Query this user's detail`}],},
        config
    );
    console.log(result.structuredResponse);
}
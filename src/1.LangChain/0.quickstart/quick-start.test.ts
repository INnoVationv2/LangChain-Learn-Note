import {tool} from "@langchain/core/tools";
import * as z from "zod";
import {AIMessage, createAgent, providerStrategy, todoListMiddleware, type ToolRuntime} from "langchain";
import {test} from "vitest";
import {ApiKey, BaseURL, model, MODEL} from "../../tools/utils.ts";
import {getSunnyWeather} from "../1.core-components/4.tool.test";
import {ChatOpenAI} from "@langchain/openai";
import {MemorySaver} from "@langchain/langgraph";
import {createFilesystemMiddleware, createSubAgentMiddleware, StateBackend} from "deepagents";

test('Basic Agent', async () => {
    const agent = createAgent({
        model: model, tools: [getSunnyWeather]
    })

    const msg = await agent.invoke({
        messages: [{role: "user", content: "What's the weather in San Francisco?"}]
    })

    console.log(msg.messages.at(-1)!.content)
})

// 格式化输出
test('Output Format', async () => {
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
        responseFormat: providerStrategy(UserDetailSchema),
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
});

// 使用thread_id保持Message List
test('History messages', async () => {
    const agent = createAgent({
        model: model,
        tools: [],
        checkpointer: new MemorySaver(),
    });

    const config1 = {configurable: {thread_id: crypto.randomUUID()}};
    const config2 = {configurable: {thread_id: crypto.randomUUID()}};

    await agent.invoke(
        {messages: [{role: "user", content: "My name is Luke and my age is 66"},],},
        config1,
    );

    await agent.invoke(
        {messages: [{role: "user", content: "My name is Zebra and my age is 88"},],},
        config2,
    );

    // 同样的问题, 因为历史Message不一样, 回答也不一样
    let result = await agent.invoke(
        {messages: [{role: "user", content: "What is my name and my age?"}]},
        config1,
    );
    console.log(result.messages.at(-1)?.content)

    result = await agent.invoke(
        {messages: [{role: "user", content: "What is my name and my age?"}]},
        config2,
    );
    console.log(result.messages.at(-1)?.content)
})

test('Context', async () => {
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

    const agent = createAgent({
        model: model,
        tools: [getUserDetailTool],
        contextSchema,
        checkpointer: new MemorySaver(),
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
        console.log(result.messages.at(-1)?.content + '\n');
    }
})


test('Stream', async () => {
    const agent = createAgent({
        model: model
    })

    const stream = await agent.streamEvents(
        {messages: [{role: "user", content: "Search for AI news and summarize the findings",},],},
        {version: "v3"},
    );

    for await (const snapshot of stream.values) {
        const message = snapshot.messages.at(-1);
        if (!message) continue;

        if (message.type === "human") {
            console.log(`User: ${message.content}`);
        } else if (AIMessage.isInstance(message)) {
            if (message.content) {
                console.log(`Agent: ${message.content.toString()}`);
            }
            if (message.tool_calls?.length) {
                const names = message.tool_calls.map(tc => tc.name);
                console.log(`Calling tools: ${names.join(", ")}`);
            }
        }
    }
});

/*
* 启用sub_agent，sub_agent独立完成任务返回结果
* 对话历史不会被合并到主 Agent，
* 从而保持主Agent上下文清晰。
* */
test('SubAgent', async () => {
    const search = tool((
        {query}) => `Search results for: ${query}`, {
        name: "search",
        description: "Search for a query and return a short summary.",
        schema: z.object({query: z.string()}),
    });

    const backend = new StateBackend();

    const agent = createAgent({
        model: model,
        tools: [],
        middleware: [
            createFilesystemMiddleware({backend}),
            todoListMiddleware(),
            createSubAgentMiddleware({
                defaultModel: model,
                defaultTools: [],
                subagents: [{
                    name: "researcher",
                    description: "Searches and returns a structured summary.",
                    systemPrompt:
                        "Use the search tool to research the question and summarize key points.",
                    tools: [search],
                    model: model,
                    middleware: []
                }],
            }),
        ],
    });
})


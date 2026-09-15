import {createAgent, createMiddleware, tool, type ToolRuntime} from "langchain";
import {HumanMessage} from '@langchain/core/messages';
import {test} from 'vitest'
import {closeThinkingMode, model} from "./2.model.test";
import {getWeather} from "../../tools/tools";
import {z} from "zod";
import {StateSchema} from "@langchain/langgraph";

const AnswerFormat =
    z.object({
        Greet: z.string(),
        City: z.string(),
        Temperature: z.string(),
    });

test('Agent Basic Demo', async () => {
    // 创建Agent
    const agent =
        createAgent({
            model: closeThinkingMode,
            tools: [getWeather],
            systemPrompt: "Add greet `meow~, Master:` Before every reply.",
            responseFormat: AnswerFormat,
        })

    const msg = await agent.invoke({
        messages: [new HumanMessage("How is the weather of NY")]
    })

    console.log(msg.messages.at(-1)!.content)
})

/*
context的定位: 外部提供的运行条件, 当前用户、权限、数据库连接。
              恢复任务时，由调用方重新提供适合这次运行
state的定位是: Agent 执行到哪里了, 消息历史、当前步骤、
              已经得到的结果。恢复任务时，需要接着这些数据继续。
* */
test('State Demo', async () => {
    const MyStateSchema = z.object({name: z.string(),});
    const myContextSchema = z.object({
        password: z.string()
    })

    const getUserDetailSchema = z.object({userId: z.string()})
    const fn = ({userId}: z.infer<typeof getUserDetailSchema>, runtime: ToolRuntime<unknown, typeof myContextSchema>) => {
        return `Username: ${runtime.state!.name}, UserID: ${userId}, Password: ${runtime.context.password}`
    }

    const getUserDetailTool = tool(
        fn,
        {
            name: 'getUserDetail',
            description: 'Get user detail by user id',
            schema: getUserDetailSchema
        }
    )

    const middleware = createMiddleware({
        name: "PrintName",
        stateSchema: MyStateSchema,
        contextSchema: myContextSchema,

        beforeModel: (state, runtime) => {
            console.log(`before ${state.name}, password is ${runtime.context.password}`);
        },
        afterModel: (state, runtime) => {
            console.log(`before ${state.name}, password is ${runtime.context.password}`);
        },
    });

    const agent = createAgent({
        model: model,
        tools: [getUserDetailTool],
        middleware: [middleware],
    });

    const msg = await agent.invoke(
        {
            messages: [new HumanMessage("Get User Detail where user id is 8")],
            // State
            name: "Luke",
        },
        {context: {password: "123456"}}
    );

    console.log(msg.messages.at(-1)!.content)
})


test('Context Demo', async () => {
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

    const MyState = new StateSchema({name: z.string(),});

    const middleware = createMiddleware({
        name: "PrintName",
        stateSchema: MyState,
        beforeModel: (state) => {
            console.log("before " + state.name);
        },
        afterModel: (state) => {
            console.log("after " + state.name);
        },
    });

    const agent = createAgent({
        model: model,
        tools: [],
        middleware: [middleware],
    });

    await agent.invoke({
        messages: [{role: 'human', content: '你好'}],
        // State
        name: "Agent State",
    });
})

import {createAgent, createMiddleware} from "langchain";
import {StateSchema} from "@langchain/langgraph";
import * as z from "zod";
import {model} from "../tools/utils.ts";

const MyState = new StateSchema({
    name: z.string(),
});

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
    messages: [{role: "user", content: "你好"}],
    name: "Agent State",
});
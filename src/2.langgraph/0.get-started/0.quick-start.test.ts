import {tool} from "@langchain/core/tools";
import * as z from "zod";
import {
    ConditionalEdgeRouter,
    END,
    GraphNode,
    MessagesValue,
    ReducedValue, START,
    StateGraph,
    StateSchema
} from "@langchain/langgraph";
import {HumanMessage, SystemMessage, ToolMessage} from "@langchain/core/messages";
import {AIMessage} from "langchain";
import {model} from "../../1.langchain/1.core-components/2.model.test";

// A simple calculate demo
const add = tool(({a, b}) => a + b, {
    name: "add",
    description: "Add two numbers",
    schema: z.object({
        a: z.number().describe("First number"),
        b: z.number().describe("Second number"),
    }),
});

const multiply = tool(({a, b}) => a * b, {
    name: "multiply",
    description: "Multiply two numbers",
    schema: z.object({
        a: z.number().describe("First number"),
        b: z.number().describe("Second number"),
    }),
});

const divide = tool(({a, b}) => a / b, {
    name: "divide",
    description: "Divide two numbers",
    schema: z.object({
        a: z.number().describe("First number"),
        b: z.number().describe("Second number"),
    }),
});

// Augment the LLM with tools
const toolsByName: Record<string, typeof add | typeof multiply | typeof divide> = {
    [add.name]: add,
    [multiply.name]: multiply,
    [divide.name]: divide,
};
const tools = Object.values(toolsByName);
const modelWithTools = model.bindTools(tools);

const MessagesState = new StateSchema({
    messages: MessagesValue,
    llmCalls: new ReducedValue(
        z.number().default(0),
        {reducer: (x, y) => x + y}
    ),
});

const llmCall: GraphNode<typeof MessagesState> = async (state) => {
    return {
        messages: [await modelWithTools.invoke([
            new SystemMessage(
                "You are a helpful assistant tasked with performing arithmetic on a set of inputs."),
            ...state.messages,
        ])],
        llmCalls: 1,
    };
};

const toolNode: GraphNode<typeof MessagesState> = async (state) => {
    const lastMessage = state.messages.at(-1);

    if (lastMessage == null || !AIMessage.isInstance(lastMessage))
        return {messages: []};

    const result: ToolMessage[] = [];
    for (const toolCall of lastMessage.tool_calls ?? []) {
        const tool = toolsByName[toolCall.name];
        const observation = await tool.invoke(toolCall);
        result.push(observation);
    }

    return {messages: result};
};

const shouldContinue: ConditionalEdgeRouter<{ InputSchema: typeof MessagesState; Nodes: "toolNode" }> = (state) => {
    const lastMessage = state.messages.at(-1);
    if (!lastMessage || !AIMessage.isInstance(lastMessage))
        return END;

    if (lastMessage.tool_calls?.length)
        return "toolNode";

    return END;
};

const agent = new StateGraph(MessagesState)
    .addNode("llmCall", llmCall)
    .addNode("toolNode", toolNode)
    .addEdge(START, "llmCall")
    .addConditionalEdges("llmCall", shouldContinue, ["toolNode", END])
    .addEdge("toolNode", "llmCall")
    .compile();

const result = await agent.invoke({
    messages: [new HumanMessage("Add 3 and 4.")],
});

for (const message of result.messages)
    console.log(`[${message.type}]: ${message.text}`);
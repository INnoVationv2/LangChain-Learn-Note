import {test} from "vitest";
import {Command, END, GraphNode, interrupt, MemorySaver, START, StateGraph, StateSchema} from "@langchain/langgraph";
import {z} from "zod";

test('Interrupt Basic', async () => {
    const stateSchema = new StateSchema({
        name: z.string(),
        age: z.string(),
        sex: z.string(),
        personInfo: z.object(),
    })

    const nodeA: GraphNode<typeof stateSchema> = async (state) => {
        const name = interrupt("What is your name?");
        const age = interrupt("What is your age?");
        const sex = interrupt("What is your sex?");
        const personInfo = interrupt("What is your person info?");
        return {name: name, age: age, sex: sex, personInfo: personInfo}
    }

    const graph = new StateGraph(stateSchema)
        .addNode("nodeA", nodeA)
        .addEdge(START, "nodeA")
        .addEdge("nodeA", END)
        .compile({checkpointer: new MemorySaver()});

    const config = {configurable: {thread_id: crypto.randomUUID()}};
    await graph.invoke({}, config)

    await graph.invoke(new Command({resume: 'luke'}), config);
    await graph.invoke(new Command({resume: '18'}), config);
    await graph.invoke(new Command({resume: 'male'}), config);
    const output = await graph.invoke(new Command({resume: {'school': 'SJTU', 'car': 'benz'}}), config);
    console.log(output);
}, 600_000)


test('Verify Input', async () => {
    const stateSchema = new StateSchema({
        age: z.number().nullable(),
        pendingQuestion: z.string().nullable(),
    });

    const nodeA: GraphNode<typeof stateSchema> = async (state) => {
        const question = state.pendingQuestion ?? "What is your age?";
        const answer = interrupt(question);
        if (typeof answer === "number" && answer > 0)
            return {age: answer, pendingQuestion: null};
        return {pendingQuestion: `'${answer}' is not a valid age. Please enter a positive number.`};
    }

    const graph = new StateGraph(stateSchema)
        .addNode("nodeA", nodeA)
        .addEdge(START, "nodeA")
        // 注意看这里
        .addConditionalEdges("nodeA", (state) =>
            state.age != null ? END : "nodeA"
        )
        .compile({checkpointer: new MemorySaver()});

    const config = {configurable: {thread_id: crypto.randomUUID()}};
    await graph.invoke({}, config)

    let output = await graph.invoke(new Command({resume: 'no'}), config);
    console.log(output);

    output = await graph.invoke(new Command({resume: 18}), config);
    console.log(output);
}, 600_000)

// 观察哪些node和代码重新执行了
test('Subgraph interrupt', async () => {
    const stateSchema = new StateSchema({});

    const subNodeB: GraphNode<typeof stateSchema> = async () => {
        console.log("subNodeB")
        const age = interrupt("What is your age?");
        console.log(`subNodeB Age:${age}`);
    }

    const subGraph = new StateGraph(stateSchema)
        .addNode('subNodeA', async () => console.log("subNodeA"))
        .addNode('subNodeB', subNodeB)
        .addEdge(START, "subNodeA")
        .addEdge('subNodeA', "subNodeB")
        .addEdge('subNodeB', END)
        .compile()

    const nodeA: GraphNode<typeof stateSchema> = async () => {
        console.log("NodeA")
        const result = await subGraph.invoke({})
        console.log(result);
    }

    const graph = new StateGraph(stateSchema)
        .addNode('nodeA', nodeA)
        .addEdge(START, "nodeA")
        .addEdge('nodeA', END)
        .compile({checkpointer: new MemorySaver()})
    const config = {configurable: {thread_id: crypto.randomUUID()}};

    let output = await graph.invoke({}, config)
    console.log(output);

    output = await graph.invoke(new Command({resume: 18}), config);
    console.log(output);
})
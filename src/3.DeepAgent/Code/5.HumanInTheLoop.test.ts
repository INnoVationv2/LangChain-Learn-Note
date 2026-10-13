import {HITLRequest, Interrupt, tool} from 'langchain';
import {createDeepAgent} from 'deepagents';
import {MemorySaver} from '@langchain/langgraph';
import {v7 as uuid7} from 'uuid';
import {Command} from '@langchain/langgraph';
import {test} from 'vitest'
import {model} from '../../tools/utils.ts';
import {HumanMessage} from '@langchain/core/messages';
import {getRainingWeather, getSunnyWeather} from '../../1.LangChain/1.core-components/4.tool.test.ts';

const checkpointer = new MemorySaver();
const agent = createDeepAgent({
    model: model,
    tools: [getSunnyWeather, getRainingWeather],
    interruptOn: {
        [getSunnyWeather.name]: true,
        // 等价于:
        // [getWeather.name]: {allowedDecisions: ['approve', 'edit', 'reject']},
    },
    checkpointer, // Required!
});

test('Add Interrupt', async () => {
    const config = {configurable: {thread_id: uuid7()}};
    let result = await agent.invoke({
        messages: [new HumanMessage('How is the weather of NY')],
    }, config);

    if (result.__interrupt__) {
        const interrupts = result.__interrupt__[0].value as HITLRequest;
        const actionRequests = interrupts.actionRequests;
        const reviewConfigs = interrupts.reviewConfigs;

        const configMap = Object.fromEntries(
            reviewConfigs.map((cfg) => [cfg.actionName, cfg])
        );

        for (const action of actionRequests) {
            const reviewConfig = configMap[action.name];
            console.log(`Tool: ${action.name}`);
            console.log(`Arguments: ${JSON.stringify(action.args)}`);
            console.log(`Allowed decisions: ${reviewConfig.allowedDecisions}`);
        }

        const decisions = [
            {
                type: 'reject',
                message: 'User rejected get weather. Do not retry again.',
            }
        ];

        result = await agent.invoke(
            new Command({resume: {decisions}}),
            config
        );
    }

    console.log(result.messages[result.messages.length - 1].content);
})

test('Edit Interrupt', async () => {
    const config = {configurable: {thread_id: uuid7()}};
    let result = await agent.invoke({
        messages: [new HumanMessage('How is the weather of NY')],
    }, config);

    if (result.__interrupt__) {
        const decisions = [
            {
                type: 'edit',
                editedAction: {
                    // 修改成其他Tool
                    name: getRainingWeather.name,
                    args: {city: 'Peking'},
                }
            }
        ];

        result = await agent.invoke(
            new Command({resume: {decisions}}),
            config
        );
    }

    console.log(result.messages[result.messages.length - 1].content);
})

test('Handle Interrupts With Streaming', async () => {
    const config = {configurable: {thread_id: uuid7()}};
    let streamInput: Parameters<typeof agent.stream>[0] | Command = {
        messages: [new HumanMessage('How is the weather of NY')]
    };

    while (true) {
        let pendingInterrupt: Interrupt<HITLRequest> | undefined;

        for await (const chunk of await agent.stream(
            streamInput,
            {
                streamMode: ["messages", "updates"],
                ...config,
            }
        )) {
            const [mode, data] = chunk;

            if (mode === "messages") {
                const [token] = data;
                if (token.text)
                    process.stdout.write(token.text);
            }

            if (mode === "updates" && data?.__interrupt__) {
                pendingInterrupt = data.__interrupt__[0];
            }
        }

        if (!pendingInterrupt) break;

        const interruptValue = pendingInterrupt.value;
        const actionRequests = interruptValue.actionRequests;
        const reviewConfigs = interruptValue.reviewConfigs;
        const configMap = Object.fromEntries(
            reviewConfigs.map((cfg: any) => [cfg.actionName, cfg])
        );

        for (const action of actionRequests) {
            const review = configMap[action.name];
            console.log(`\nTool: ${action.name}`);
            console.log(`Arguments: ${JSON.stringify(action.args)}`);
            console.log(`Allowed: ${review.allowedDecisions}`);
        }

        const decisions = actionRequests.map(() => ({type: "approve"}));
        // 既可以指定中断ID
        streamInput = new Command({resume: {[pendingInterrupt.id]: {decisions}}});
        // 也可以不指定中断ID, 顺序匹配中断
        // streamInput = new Command({resume: {decisions}});
    }

    process.stdout.write("\n");
})
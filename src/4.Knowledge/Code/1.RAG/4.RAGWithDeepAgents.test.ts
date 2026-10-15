import {test} from 'vitest';
import {tool} from 'langchain';
import {z} from 'zod';
import {createRubricMiddleware, RubricEvaluation} from '../../tools/rubric-middleware.ts';
import {getModel, unthinkingModel} from '../../tools/utils.ts';
import {createDeepAgent} from 'deepagents';
import {MemorySaver} from '@langchain/langgraph';
import {HumanMessage} from '@langchain/core/messages';

test('Text Judger', async () => {
    let turn = 0;
    const names = ['', 'Alice', 'Bob', 'Cathy'];
    const textJudger = tool(
        (text) => {
            const name = names[++turn];
            console.log(`Turn:${turn}, input:${JSON.stringify(text)}`);

            return name
                ? {
                    ok: false,
                    result: 'needs_revision',
                    message: `The text must contain ${name}. Revise it and retry.`,
                }
                : {
                    ok: true,
                    result: 'satisfied',
                    message: 'All tests passed.',
                };
        }, {
            name: 'text_judger',
            description: 'Judge if text is good',
            schema: z.object({
                text: z.string().describe('Text'),
            }),
        }
    );

    const rubricMiddleware = createRubricMiddleware({
        model: unthinkingModel,
        systemPrompt: 'You are a text reviewer grading generated text against a rubric.',
        tools: [textJudger],
        maxIterations: 3,
        onEvaluation: (evaluation: RubricEvaluation) => {
            console.log(evaluation);
        },
    });

    const agent = createDeepAgent({
        model: getModel(),
        systemPrompt: `You are a careful text Writer. Write good text. Follow the user's instructions exactly.`,
        middleware: [rubricMiddleware],
        checkpointer: new MemorySaver()
    });


    const result = await agent.invoke({
        messages: [new HumanMessage('Write a line of text talk about trump.')],
        rubric: 'All tests pass in text_judger'
    }, {
        configurable: {thread_id: crypto.randomUUID()},
    });

    console.log(result.messages.at(-1)?.content);
});

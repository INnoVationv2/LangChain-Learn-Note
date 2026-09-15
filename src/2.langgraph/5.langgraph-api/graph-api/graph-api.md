# 一.Graph API
LangGraph 将智能体工作流建模为图，通过三个核心组件定义行为：

1. `State`：共享数据结构，保存应用当前的数据快照。可以是任意类型，通常通过统一的Schema定义。
2. `Nodes`：执行智能体逻辑的函数，接收当前状态，进行计算或产生副作用，并返回状态更新。
3. `Edges`：决定接下来执行哪个节点，可以是固定连接，也可以是根据当前状态选择的条件分支。

## 1.State

### 1.`StateSchema`

字段类型有4种

```ts
const AgentState = new StateSchema({
  // 1.简单字段
  currentStep: z.string(),
  retryCount: z.number().default(0),

  // 2.reducer函数字段
  allSteps: new ReducedValue(
    z.array(z.string()).default(() => []),
    {
      inputSchema: z.string(),
      reducer: (current, newStep) => [...current, newStep],
    }
  ),
  
  // 3.MessagesValue: 传入message会追加到最后
  messages: MessagesValue,

  // 4.无法保存到检查点的临时值
  tempCache: new UntrackedValue(z.record(z.string(), z.unknown())),
});
```

#### `Reducer() Value`

`reducer()`是一个二元函数，有两个参数：

- **Left 参数**：State中存储的该键的值。
- **Right 参数**： 从Node返回的该键的待更新值。

```ts
const State = new StateSchema({
  tags: new ReducedValue(
    z.array(z.string()).default(() => []),
    {
      reducer: (left: string[], right: string[]) => {
        // 把right追加到left
        return left.concat(right);
      },
    }
  ),
});
```

`State Schema`里面的所有字段底层都是`Reducer`

```ts
// 简单字段: 接收新值，然后替换旧值。
value: new ReducedValue(z.string(), {
    reducer: (_: string, right: string) => {
        return right
    }
});

// MessagesValue: 将传入的Message追加进数组
messagesReducer: 
new ReducedValue(
  z.array(z.instanceof(HumanMessage)).default(() => [])
 , { reducer: (left, right) => left.concat(...right)}),
```

#### UntrackedValue

这种值在执行期间会存在, 但不会被检查点存储。当图从检查点恢复时，会被重置为其初始状态（或变得不可用）。

适用于：

- 无法序列化的数据库连接
- 恢复时需要重建的临时缓存
- 不想持久化的大型对象
- 运行时配置，每次都需要重新传递

工作逻辑:

- 执行期间：存储和访问方式与其他State相同
- 检查点：UntrackedValue不会被保存进检查点.
- 恢复运行时：会被设为空或使用默认值。
- `guard(默认为true)`：若多个节点在同一Step写入数据，则抛出错误, false允许多次写入，最后一次写入的值生效。

```ts
  tempCache: new UntrackedValue(
    z.record(z.string(), z.unknown()),
    { guard: true }
  ),
```

### 2.更新State

两种方法

```ts
const State = new StateSchema({
  messages: MessagesValue,
  value: z.number(),
});
// 1.Node直接返回值, 会自动保存到State中
const node: GraphNode<typeof State> = (state) => {
  return { messages: [new AIMessage("Hello!")], value: 10 };
};

// 2.通过Command更新
const nodeA = async (state: typeof stateSchema.State) => {
    return new Command({
      update: {
        messages: [new HumanMessage('Hello')],
        value: 2,
      }
    })
}
```



### 3. State, Update, Node

从Schema中获取状态和更新类型

```ts
const MyStateSchema = new StateSchema({
  messages: MessagesValue,
  count: z.number().default(0),
});

// 提取状态类型
// MyState: {messages: BaseMessage[], count: number}
type MyState = typeof MyStateSchema.State;

// 提取更新类型(partial, with reducer input types)
// MyUpdate: {messages?: Messages, count?: number}
type MyUpdate = typeof MyStateSchema.Update;

// 提取Node函数的参数和返回值
// MyNode: (state: MyState,  config: RunnableConfig) => MyUpdate | Promise<MyUpdate>;
type MyNode = typeof MyStateSchema.Node;
```

## 2. Node

### 1. Node定义

```ts
const State = new StateSchema({
    count: z.number().default(0),
    result: z.string(),
});

//写法1
const fetchNode_1: GraphNode<typeof State> = async (state, config) => {
    const response = await fetch(`/api/data/${state.count}`);
    return {result: await response.text()};
};

// 写法2, 这种写法不支持返回Command
const fetchNode_2: typeof State.Node = async (state) => {
    const response = await fetch(`/api/data/${state.count}`);
    return {result: await response.text()};
}
```

### 2.在Node中使用task

如果一个`Node`包含多个操作，那么将每个操作作为`task`比拆分逻辑成多个Node中更容易。而且task的结果会被保存到检查点，因此恢复线程可以跳过节点内已完成的任务。

```ts
const makeRequest = task("makeRequest", async (url: string) => {
  const response = await fetch(url);
  const text = await response.text();
  return text.slice(0, 100);
});

const callApi: GraphNode<typeof State> = async (state) => {
  const pending = state.urls.map((url) => makeRequest(url));
  const results = await Promise.all(pending);
  return { results };
};
```

### 3.Node缓存

可以为Node添加Cache, 缓存Node结果，相同输入时跳过重复计算

```ts
const State = new StateSchema({
  x: z.number(),
  result: z.number(),
});

const expensiveNode: GraphNode<typeof State> = async (state) => {
  // Simulate an expensive operation
  await new Promise((resolve) => setTimeout(resolve, 3000));
  return { result: state.x * 2 };
};

const graph = new StateGraph(State)
  .addNode("expensive_node", expensiveNode, { cachePolicy: { ttl: 3 } })
  .addEdge(START, "expensive_node")
  .compile({ cache: new InMemoryCache() });
```

也可以为Node指定缓存策略: 

- `keyFunc:`指定缓存的Key值。

  ```ts
  注: 缓存保存的是节点执行的整体结果, keyFunc判断是否复用缓存的Key值。
  有如下keyFunc: keyFunc: (input) => `user:${input.userId}`
  ```

  | 调用 | 输入                       | 行为                                                  |
  | ---- | -------------------------- | ----------------------------------------------------- |
  | 1    | `userId=123`，其他字段任意 | 没有缓存，节点接收全部字段并执行，结果存到 `user:123` |
  | 2    | `userId=123`，其他字段改变 | userId相同, 若缓存未过期, 则节点不执行, 直接复用结果  |
  | 3    | `userId=456`               | 缓存键不同，没有对应缓存就执行节点                    |

- TTL: `缓存的生存时间，单位为秒。如果未指定，则缓存永不过期。

### 4.特殊节点

- `START`节点: 表示接收用户输入的节点
- `END`节点: 表示终止节点

### 5.添加重试策略

```ts
const graph = new StateGraph(State)
  .addNode("nodeName", nodeFunction, { retryPolicy: {} })
  .compile();
```

retryPolicy定义如下:

```ts
type RetryPolicy = {
  /** 首次重试前的等待时间，单位ms，默认 500 */
  initialInterval?: number;

  /** 每次重试后，等待时间的增长倍数，默认 2 */
  backoffFactor?: number;

  /** 两次尝试之间的最大等待时间，单位ms，默认 128000 */
  maxInterval?: number;

  /** 最大尝试次数，包含首次执行，默认 3 */
  maxAttempts?: number;

  /** 是否给等待时间添加随机抖动，默认 true */
  jitter?: boolean;

  /** 判断异常是否需要重试：返回 true 重试，false 不重试 */
  retryOn?: (e: any) => boolean;

  /** 重试时是否记录警告日志，默认 true */
  logWarning?: boolean;
};
```

Demo

```ts
 .addNode("query_database", queryDatabase, {
    retryPolicy: {
      retryOn: (e: any): boolean => {
        if (e instanceof Database.SqliteError) {
          // Retry on "SQLITE_BUSY" error
          return e.code === "SQLITE_BUSY";
        }
        return false; // Don't retry on other errors
      },
    },
  })
```

### 6.跳转到多个节点

```ts
const routeBcOrCd: ConditionalEdgeRouter<{ InputSchema: typeof State; Nodes: "b" | "c" | "d" }> = (state) => {
  if (state.which === "cd") {
    return ["c", "d"];
  }
  return ["b", "c"];
};
```

## 3.Edge

边主要有以下几种类型：

- **普通边**：从一个节点直接进入下一个节点。
- **条件边**：调用函数，决定接下来执行哪些节点。
- **入口点**：收到用户输入后，首先执行的节点。
- **条件入口点**：收到用户输入后，调用函数决定首先执行哪些节点。

一个节点可以有多条出边。这些边指向的所有目标节点，都会在下一个**超步(superstep)**中并行执行。

每个节点应只选择一种路由机制：

- **静态路由**：使用普通边。
- **动态路由**：使用条件边或 `Command`。

不要在同一个节点上混用普通边和动态路由，因为两条路径都可能执行，使图的行为难理解。

1. 普通边

   ```ts
   graph.addEdge(START, "nodeA");
   graph.addEdge("nodeA", "nodeB");
   graph.addEdge(nodeB, "END");
   ```

### 条件边

不更新状态，仅路由

   ```ts
   const routeSchema = new StateSchema({
       score: z.number().default(0),
   })
   
   function routeNode(state: typeof routeSchema.State) {
       if (state.score >= 60) return "nodeB";
     	// 可以同时执行多个节点，返回数组：
       return state.score === 0 ? ["nodeC", "nodeD"] : [END];
       return END;
   }
   
   // 这里必须传入route函数，不能传入Node名字的字符串。
   graph.addConditionalEdges("nodeA", routeNode);
   graph.addConditionalEdges("nodeA", 'routeNode'); // 错误
   ```

也可以提供一个对象，将**routingFunction**的输出映射为下一个节点的名称。

```ts
graph.addConditionalEdges("nodeA", routingFunction, {
  true: "nodeB",
  false: "nodeC",
});
```

条件边同样适用于START节点, 自定义逻辑从不同的节点开始任务。

## 4. Send

普通的Graph跳转共享的是State, Send可以只发送一部分的数据, 也可以构造数据.

```ts
const sendNode = (state: typeof stateSchema.State) => state.nameList.map((name) => new Send('nodeB', {name}))

//同样传入sendNode的函数
graph.addConditionalEdges(START, sendNode);
```

## 5. Command

`Command`用于控制Graph执行。接收四个参数：

- update：更新State。
- goto：跳转到特定节点。
- graph : 从子图导航时，以父图为目标。
- resume ：提供一个值，在中断后恢复执行。

`Command` 用于三种场景：

- **从Node返回**：使用 `update`、`goto` 和 `graph`，同时更新状态并控制执行流程。
- **作为 `invoke` 或 `stream` 的输入**：使用 `resume`，恢复被 `interrupt` 暂停的执行。
- **从Tool返回**：与从Node返回类似，在工具内部同时更新状态并控制执行流程。

### 1.**Node返回Command**

```ts
graph.addNode("NodeA", (state) => {
  return new Command({
    update: { foo: "bar" },
    goto: "NodeB",
  });
});
```

使用Command时，添加节点必须添加ends参数，指定该节点可以路由到哪些节点：

```ts
builder.addNode("myNode", myNode, {
  ends: ["myOtherNode", END],
});
```

> 注: Command添加的是动态边, 使用`addEdge`定义的静态边仍然会执行。如果既定义了静态边，又返回动态边，那这两个节点将都执行
>
> 对于每个节点, 不要同时使用`Command`和静态边。

2. Graph跳转

   如果使用了**子图(subgraph)**，可通过在Command中指定`graph:Command.PARENT `，从子图中的节点导航到父图中的节点：

   ```ts
   graph.addNode("myNode", (state) => {
     return new Command({
       update: { foo: "bar" },
       goto: "otherSubgraph", // `otherSubgraph`是父图中的一个节点名
       graph: Command.PARENT,
     });
   });
   ```

### 2.作为`invoke`或`stream`的输入

遇到`interrupt()`时,传入`new Command({ resume: ... })`继续执行

resume的值会作为interrupt()的返回值。

```ts
const humanReview = async (state: typeof StateAnnotation.State) => {
  const answer = interrupt("Do you approve?");
  return { messages: [{ role: "user", content: answer }] };
};

const result = await graph.invoke({ messages: [...] }, config);

const resumed = await graph.invoke(new Command({ resume: "yes" }), config);
```

### 3.Tool返回Command

Tool也可以返回 `Command`，更新State并控制执行流程：

- `update`：修改状态，例如保存对话中查询到的客户信息。
- `goto`：指定工具执行完成后要跳转的节点。

同样的, Tool如果返回动态边,不要和静态边混用

```ts
const lookupUserInfo = tool(
  async (input, runtime) => {
    const userId = runtime.serverInfo?.user?.identity;
    const userInfo = getUserInfo(userId);
    return new Command({
      update: {userInfo: userInfo},
      goto: "otherSubgraph",
    });
  },
  {
    name: "lookupUserInfo",
    description: "...",
    schema: z.object({}),
  }
);
```

### 4.子图跳转到父图

```ts
const myNode = (state: State): Command => {
  return new Command({
    update: { foo: "bar" },
    goto: "otherSubgraph",//父图中的Node名
    graph: Command.PARENT //父图
  });
};
```



## 6.Context

在创建图的时候，可以指定`ContextSchema`, 用来保存一些只读的静态配置。

```ts
const stateSchema = new StateSchema({
    input: z.string(),
    output: z.string(),
});

const contextSchema = z.object({
    dbUsername: z.string(),
    dbPassword: z.string(),
    dbUrl: z.string(),
});

const nodeA: typeof stateSchema.Node =
    async (state, config) => {
        console.log(config.context.dbUrl);
        console.log(config.context.dbUsername);
        console.log(config.context.dbPassword);
        return {output: state.input};
    }

const graph = new StateGraph(stateSchema, contextSchema)
    .addNode("nodeA", nodeA)
    .addEdge(START, "nodeA")
    .addEdge("nodeA", END)
    .compile();

const config = {context: {dbUsername: "admin", dbPassword: "123456", dbUrl: "mysql"}};
console.log(await graph.invoke({input: "Hello"}, config));
```

### 1. SuperStep

图单次执行的最大`SuperStep`数默认为25步。达到此限制，将抛出`GraphRecursionError`。

```ts
await graph.invoke(inputs, {
  recursionLimit: 5,
  context: { llm: "anthropic" },
});

// 获取当前 SuperSteps 数
config.metadata.langgraph_step
```

### 2.运行时指定LLM和System Prompt

```ts
const ConfigSchema = z.object({
  modelProvider: z.string().default("anthropic"),
  systemMessage: z.string().optional(),
});

const State = new StateSchema({
  messages: MessagesValue,
});

const MODELS = {
  anthropic: new ChatAnthropic({ model: "claude" }),
  openai: new ChatOpenAI({ model: "gpt" }),
};

const callModel: GraphNode<typeof State> = async (state, config) => {
  const modelProvider = config?.configurable?.modelProvider || "anthropic";
  const systemMessage = config?.configurable?.systemMessage;

  const model = MODELS[modelProvider as keyof typeof MODELS];
  let messages = state.messages;

  if (systemMessage)
    messages = [new SystemMessage(systemMessage), ...messages];

  const response = await model.invoke(messages);
  return { messages: [response] };
};

const graph = new StateGraph(State, ConfigSchema)
  .addNode("model", callModel)
  .addEdge(START, "model")
  .addEdge("model", END)
  .compile();

// Usage
const inputMessage = { role: "user", content: "hi" };
const response = await graph.invoke(
  { messages: [inputMessage] },
  {
    configurable: {
      modelProvider: "openai",
      systemMessage: "Respond in Italian."
    }
  }
);
```

## 7. Runtime

### 1. 访问节点内部的执行信息

| 属性                   | 类型                 | 说明                                                     |
| ---------------------- | -------------------- | -------------------------------------------------------- |
| `threadId`             | `string | undefined` | 当前执行所属的会话线程 ID。                              |
| `runId`                | `string | undefined` | 当前这次运行的 ID。                                      |
| `checkpointId`         | `string`             | 当前执行的检查点 ID。                                    |
| `checkpointNs`         | `string`             | 当前执行的检查点命名空间。                               |
| `taskId`               | `string`             | 当前执行的任务 ID。                                      |
| `nodeAttempt`          | `number`             | 当前节点的尝试次数，从 1 开始。                          |
| `nodeFirstAttemptTime` | `number | undefined` | 首次尝试开始时的 Unix 时间戳，单位为秒；重试时保持不变。 |

## 8.Graph可视化

```ts
const drawableGraph = await graph.getGraphAsync();
//打印为文字
console.log(drawableGraph.drawMermaid());
// 转换为png格式
const image = await drawableGraph.drawMermaidPng();
const imageBuffer = new Uint8Array(await image.arrayBuffer());
await fs.writeFile("graph.png", imageBuffer);
```

## 各种存储: CheckPointer, Store, Cache,State,Context


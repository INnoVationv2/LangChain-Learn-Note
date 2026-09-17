import {test} from 'vitest'
import {InMemoryStore} from "@langchain/langgraph";

test('Store Basic Usage', async () => {
    const store = new InMemoryStore();
    // 增
    await store.put(['namespace'], "1", {"name": "luke", age: 18})
    // 查
    let result = await store.get(['namespace'], "1")
    console.log(result);
    // 改
    await store.put(['namespace'], "1", {"name": "Zebra", age: 88})
    result = await store.get(['namespace'], "1")
    console.log(result);
    // 删
    await store.delete(['namespace'], "1")
    // search
    await store.put(['namespace'], "1", {"name": "luke", age: 18})
    await store.put(['namespace'], "2", {"name": "Zebra", age: 88})
    const items = await store.search(['namespace']);
    items.forEach((item) => console.log(item));
});
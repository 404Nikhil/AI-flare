import { Ai } from '@cloudflare/ai'
import { Hono } from "hono"
const app = new Hono()

app.get('/', async (c) => {
	const ai = new Ai(c.env.AI);

	const question = c.req.query('question');

	if (!question) {
		return c.text("Missing question", 400);
	}

	const embeddings = await ai.run('@cf/baai/bge-large-en-v1.5', { text: question }) // text embedding model
	const vectors = embeddings.data[0]

	const SIMILARITY_CUTOFF = 1
	const vectorQuery = await c.env.VECTOR_INDEX.query(vectors, { topK: 1 });
	const vecIds = vectorQuery.matches
		.filter(vec => vec.score > SIMILARITY_CUTOFF)
		.map(vec => vec.id)

	let answers = []
	if (vecIds.length) {
		const query = `SELECT * FROM QA_repository WHERE id IN (${vecIds.join(", ")})`
		const { results } = await c.env.DB.prepare(query).bind().all()
		if (results) answers = results.map(vec => vec.answer)
	}
	const contextMessage = answers.length
		? `Context:\n${answers.map(answer => `- ${answer}`).join("\n")}`
		: ""

		const systemPrompt = `Hello! I'm SwiftBot, your friendly chatbot, here to assist you. I'm designed to help answer questions, provide information, and even have a bit of fun. I'm here to make your experience as swift and enjoyable as possible. How can I assist you today?`;

	const { response: answer } = await ai.run(
		'@cf/meta/llama-3.1-8b-instruct', // text-generation model
		{
			messages: [
				...(answers.length ? [{ role: 'system', content: contextMessage }] : []),
				{ role: 'system', content: systemPrompt },
				{ role: 'user', content: question }
			]
		}
	)

	return c.text(answer);
})


app.get("/embeds", async (c) => {
	const { results } = await c.env.DB.prepare("SELECT * FROM TABLE_NAME").run();
	return c.json(JSON.stringify(results));
})


app.delete("/embeds/:id", async (c) => {
	const id = c.req.param('id');
	if (!id) {
		return c.text("Missing id parameter", 400);
	}
	const { success } = await c.env.DB.prepare(`DELETE FROM TABLE_NAME WHERE id = ?`)
		.bind(id).run()

	if (!success) {
		return c.text("Something went wrong", 500)
	}
	return c.text("deleted", 200)
})


app.put("/embeds/:id", async (c) => {
	const id = c.req.param('id');
	if (!id) {
		return c.text("Missing id parameter", 400);
	}
	const ai = new Ai(c.env.AI)
	const { answer, question } = await c.req.json();
	if (!answer) {
		return c.json("Missing answer", 400);
	}
	const { success } = await c.env.DB.prepare(`UPDATE TABLE_NAME SET answer = ? WHERE id = ?`)
		.bind(answer, id).run()

	if (!success) {
		return c.text("Something went wrong", 500)
	}

	const { data } = await ai.run('@cf/baai/bge-large-en-v1.5', { text: [question] })
	const values = data[0]

	if (!values) {
		return c.text("Failed to generate vector embedding", 500);
	}

	const inserted = await c.env.VECTOR_INDEX.upsert([
		{
			id: id.toString(),
			values,
		}
	])

	return c.text("updated", 201)
})



app.post('/embeds', async (c) => {
	const ai = new Ai(c.env.AI)

	const { question, answer } = await c.req.json();
	if (!question || !answer) {
		return c.json("Missing question and/or answer", 400);
	}

	const { results } = await c.env.DB.prepare("INSERT INTO TABLE_NAME (question,answer) VALUES (?,?) RETURNING *")
		.bind(question, answer)
		.run()

	const record = results.length ? results[0] : null

	if (!record) {
		return c.text("Failed to create table entry", 500);
	}

	const { data } = await ai.run('@cf/baai/bge-large-en-v1.5', { text: [question] })
	const values = data[0]

	if (!values) {
		return c.text("Failed to generate vector embedding", 500);
	}

	const { id } = record
	const inserted = await c.env.VECTOR_INDEX.upsert([
		{
			id: id.toString(),
			values,
		}
	])

	return c.json({ id, data: [question, answer], inserted }, 200)
})

export default app
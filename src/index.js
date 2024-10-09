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
	const { results } = await c.env.DB.prepare("SELECT * FROM QA_repository").run();
	return c.json(JSON.stringify(results));
})

export default app
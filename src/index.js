import { Ai } from '@cloudflare/ai'
import { Hono } from "hono"
const app = new Hono()

app.get('/', async (c) => {
	const ai = new Ai(c.env.AI);

	const question = c.req.query('question');

	if (!question) {
		return c.text("Missing question", 400);
	}
	return c.text(answer);
})

export default app
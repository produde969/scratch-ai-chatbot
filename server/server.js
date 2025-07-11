// server.js
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

app.post('/api/gemini', async (req, res) => {
  try {
    const { userInput, screenshotBase64 } = req.body;
    const parts = [{ text: userInput }];

    if (screenshotBase64) {
      parts.push({
        inlineData: {
          mimeType: 'image/png',
          data: screenshotBase64
        }
      });
    }

    const result = await model.generateContent({ contents: [{ role: 'user', parts }] });
    const response = await result.response;
    const text = response.text();

    res.json({ message: text });
  } catch (error) {
    console.error('Gemini API error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Gemini proxy server running at http://localhost:${PORT}`);
});

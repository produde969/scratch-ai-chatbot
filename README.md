# Scratch-Gemini-Chatbot

## ⚠️ NOTICE ⚠️

Hello user, I would like to thank you for your interest in using this application. If your purpose of using my application is to perform any research or make any changes, I would love for you to do so! I would like to politely ask that I receive credit for creating the original scratch-ai-chatbot repo. Please inform me via email that you will be making changes to this project. That is all I ask. Thank you very much once again for using this application for your desired purpose.


## Installation

To use this modified version of scratch you must have Git and Node.js installed

If you would like to set-up this application, enter the following prompts in your terminal:

```bash
git clone https://github.com/produde969/scratch-ai-chatbot.git
cd scratch-ai-chatbot
npm install
```

The application should now be installed

## Running Application

Running the application requires Node.js and a cloned version of the scratch-vm-for-gemini-chatbot repo.

You can clone the scratch-vm-for-gemini-chatbot repo by running the following prompts:

```bash
git clone https://github.com/produde969/scratch-vm-for-gemini-chatbot.git
```
To run the application run the following prompts:

```bash
cd scratch-vm-for-gemini-chatbot
npm install
npm link
cd scratch-ai-chatbot
npm link scratch-vm-for-gemini-chatbot
```
Now before running the code, you need to add the AI to do that, you need create an API key on ChatGPT, Google Gemini, Hugging Face etc. As long as the model is a Vision Language Model (VLM)

Create a folder called ".env" and move it into the server folder. Inside of the .env file make a variable called "GEMINI_API_KEY" 

Then make the variable GEMINI_API_KEY equivalent to the API key

Example: GEMINI_API_KEY = The_Actual_API_Key_You_Made

Once you do all of these steps, run this

```bash
npm run dev-all
```
You can now use AI inside of scratch.





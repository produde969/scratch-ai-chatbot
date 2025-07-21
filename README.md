# Scratch-AI-Chatbot

## ⚠️ *NOTICE* ⚠️

Hello user, I would like to thank you for your interest in using this application. If your purpose of using the application is to perform any research or make any changes, I would love for you to do so! I would like to politely ask that I receive credit for creating the original scratch-ai-chatbot repo. Please inform me via email that you will be making changes to this project or using this for research. That is all I ask. Thank you very much once again for using this application for your desired purpose.


## Installation

To install and use this modified version of scratch you must have Git and Node.js installed

If you would like to set-up this application, enter the following prompts in your terminal:

```bash
git clone https://github.com/produde969/scratch-ai-chatbot.git
cd scratch-ai-chatbot
npm install
```

The application should now be installed

## Other pre-requisites to run application

**Ensure you are not inside of the scratch-ai-chatbot when you are running the pre-requisites.**

Running the application requires Node.js and a cloned version of the scratch-vm-for-gemini-chatbot repo.

You can clone the scratch-vm-for-gemini-chatbot repo by running the following prompt in your terminal:

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

Create an API key from ChatGPT, Google Gemini, Hugging Face etc. As long as the model is a Vision Language Model (VLM), the program should run properly.

Inside of the scratch-ai-repo, you must create a folder called .env

Inside the .env file, create a variable named "GEMINI_API_KEY"

Set GEMINI_API_KEY equivalent to your actual API key.

For Example:

```bash
GEMINI_API_KEY=the_actual_api_key_you_have_created
```
## Running Application

To run the application, enter the following command prompt:

```bash
npm run dev-all
```
Thank you once again for using this application. I hope you enjoy the additional features on scratch.





"use client";
import React, { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { motion, AnimatePresence } from "framer-motion";
import { FiSend, FiUser, FiCpu, FiVolume2, FiMic, FiStopCircle } from "react-icons/fi";
import { EdgeSpeechTTS } from "@lobehub/tts";

// Default chat options for quick start
const defaultOptions = [
  "Tell me about the latest AI advancements",
  "Explain quantum computing",
  "What are the best practices in cybersecurity?",
  "How does blockchain technology work?",
];

// Markdown component to render formatted text
const Markdown = ({ content }) => {
  // Process the content to handle special cases and formatting
  const processedContent = content
    .replace(/\\n/g, "\n")
    .replace(/\\\*/g, "*") // Unescape asterisks
    .replace(/\\"/g, '"') // Unescape quotation marks
    .replace(/##""##/g, "") // Remove ##""## artifacts
    .replace(/""\s*([^:]+):\*\*/g, '**"$1:"**') // Handle ""Text:** pattern
    .replace(/""([^"]+)""/g, '"$1"') // Handle double quotes
    .replace(/(\w+:)"/g, '$1"') // Fix quotes after colons
    .replace(/\*\*"([^"]+)"\*\*/g, '**"$1"**'); // Ensure quotes inside bold text

  return (
    <ReactMarkdown
      className="prose mt-1 w-full break-words prose-p:leading-relaxed py-3 px-3 mark-down"
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ node, ...props }) => (
          <a
            {...props}
            style={{ color: "#27afcf", fontWeight: "bold" }}
          />
        ),
        code({ node, inline, className, children, ...props }) {
          const match = /language-(\w+)/.exec(className || "");
          return !inline && match ? (
            <SyntaxHighlighter
              style={vscDarkPlus}
              language={match[1]}
              PreTag="div"
              {...props}
            >
              {String(children).replace(/\n$/, "")}
            </SyntaxHighlighter>
          ) : (
            <code className={className} {...props}>
              {children}
            </code>
          );
        },
        p: ({ children }) => (
          <p className="whitespace-pre-line">{children}</p>
        ),
        strong: ({ children }) => (
          <strong className="font-bold">{children}</strong>
        ),
        blockquote: ({ children }) => (
          <blockquote className="border-l-4 border-gray-500 pl-4 py-2 my-2 italic bg-gray-800 rounded">
            {children}
          </blockquote>
        ),
      }}
    >
      {processedContent}
    </ReactMarkdown>
  );
};

// Main ChatStream component
const ChatStream = () => {
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState([]);
  const [chatStarted, setChatStarted] = useState(false);
  const [isListening, setIsListening] = useState(false); // STT state
  const [isPlaying, setIsPlaying] = useState(false); // Audio playback state
  const chatContainerRef = useRef(null);
  const audioQueueRef = useRef([]); // Queue for audio chunks
  const audioContextRef = useRef(null); // Web Audio API context
  const analyserRef = useRef(null); // Audio analyser for waveform
  const recognitionRef = useRef(null); // STT recognition object
  const animationFrameRef = useRef(null); // For waveform animation

  // Instantiate EdgeSpeechTTS
  const tts = new EdgeSpeechTTS({ locale: "en-US" });

  // Initialize STT
  useEffect(() => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false; // Stop after one sentence
      recognitionRef.current.interimResults = false; // Only final results
      recognitionRef.current.lang = "en-US"; // Set language

      recognitionRef.current.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        setQuestion(transcript); // Set transcribed text to input
        setIsListening(false); // Stop listening
        startChat(transcript); // Automatically send to AI
      };

      recognitionRef.current.onerror = (event) => {
        console.error("Speech recognition error:", event.error);
        setIsListening(false);
      };
    } else {
      console.warn("Speech Recognition not supported in this browser.");
    }
  }, []);

  // Initialize Web Audio API
  useEffect(() => {
    audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
    analyserRef.current = audioContextRef.current.createAnalyser();
    analyserRef.current.fftSize = 256;
  }, []);

  // Scroll to bottom of chat when new messages are added
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop =
        chatContainerRef.current.scrollHeight;
    }
  }, [messages]);

  // Handle form submission
  const handleSubmit = async (e) => {
    e.preventDefault();
    await startChat(question);
  };

  // Start or stop STT
  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      recognitionRef.current.start();
      setIsListening(true);
    }
  };

  // Convert text to speech and add to audio queue
  const addToAudioQueue = async (text) => {
    const payload = {
      input: text,
      options: {
        voice: "en-US-JennyNeural", // Choose a voice
      },
    };

    const response = await tts.create(payload);
    const audioBuffer = await response.arrayBuffer();
    audioQueueRef.current.push(audioBuffer);

    // Play audio if not already playing
    if (!isPlaying) {
      playAudioQueue();
    }
  };

  // Play audio chunks sequentially
  const playAudioQueue = async () => {
    if (audioQueueRef.current.length === 0) {
      setIsPlaying(false);
      return;
    }

    setIsPlaying(true);
    const audioBuffer = audioQueueRef.current.shift();
    const audioSource = audioContextRef.current.createBufferSource();
    audioSource.buffer = await audioContextRef.current.decodeAudioData(audioBuffer);
    audioSource.connect(analyserRef.current);
    analyserRef.current.connect(audioContextRef.current.destination);
    audioSource.start();

    // Visualize waveform
    visualizeWaveform();

    // Play the next chunk when the current one ends
    audioSource.onended = () => {
      playAudioQueue();
    };
  };

  // Visualize waveform
  const visualizeWaveform = () => {
    const bufferLength = analyserRef.current.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      animationFrameRef.current = requestAnimationFrame(draw);
      analyserRef.current.getByteTimeDomainData(dataArray);

      // Update waveform visualization (e.g., SVG or canvas)
      const waveform = document.getElementById("waveform");
      if (waveform) {
        waveform.innerHTML = Array.from(dataArray)
          .map((value, index) => `<div style="height: ${value / 2}px;"></div>`)
          .join("");
      }
    };

    draw();
  };

  // Start or continue the chat
  const startChat = async (initialQuestion) => {
    setChatStarted(true);
    setQuestion("");

    setMessages((prev) => [
      ...prev,
      { type: "user", content: initialQuestion },
      { type: "ai", content: "" },
    ]);

    try {
      // Send request to chat API
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: initialQuestion }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // Handle the streaming response
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const { text, isLast } = JSON.parse(chunk);

        buffer += text;

        // Update messages with new content
        setMessages((prev) => {
          const newMessages = [...prev];
          const lastMessage = newMessages[newMessages.length - 1];
          if (lastMessage.type === "ai") {
            lastMessage.content = buffer;
          }
          return newMessages;
        });

        // Convert text chunk to audio and add to queue
        await addToAudioQueue(text);

        if (isLast) break;
      }
    } catch (error) {
      console.error("Error in chat:", error);
      setMessages((prev) => [
        ...prev,
        {
          type: "error",
          content: "An error occurred while processing your request.",
        },
      ]);
    }
  };

  return (
    <div className="flex flex-col items-center min-h-screen bg-gray-950 text-gray-100">
      <div className="w-full md:w-4/5 lg:w-3/5 flex flex-col h-screen">
        {/* Chat messages container */}
        <div
          ref={chatContainerRef}
          className="flex-grow p-6 overflow-y-auto space-y-6 custom-scrollbar"
        >
          <AnimatePresence>
            {messages.map((message, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.3 }}
                className={`flex ${
                  message.type === "user" ? "justify-end" : "justify-start"
                }`}
              >
                <motion.div
                  whileHover={{ scale: 1.02 }}
                  className={`max-w-[80%] rounded-2xl shadow-lg ${
                    message.type === "user"
                      ? "bg-indigo-600 p-4"
                      : "bg-gray-800 p-4"
                  } flex items-start`}
                >
                  <div className="mr-3 mt-1">
                    {message.type === "user" ? (
                      <FiUser className="text-xl" />
                    ) : (
                      <FiCpu className="text-xl" />
                    )}
                  </div>
                  <div>
                    {message.type === "user" ? (
                      <p className="text-sm whitespace-pre-wrap">
                        {message.content}
                      </p>
                    ) : (
                      <Markdown content={message.content} />
                    )}
                  </div>
                  {message.type === "ai" && (
                    <button
                      onClick={() => setIsPlaying(!isPlaying)}
                      className="ml-3 mt-1 text-gray-300 hover:text-white"
                    >
                      <FiVolume2 className="text-xl" />
                    </button>
                  )}
                </motion.div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {/* Chat input area */}
        <motion.div
          initial={{ y: 50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.5 }}
          className="p-6 bg-gray-900 rounded-t-3xl shadow-lg"
        >
          {!chatStarted && (
            <div className="grid grid-cols-2 gap-4 mb-6">
              {defaultOptions.map((option, index) => (
                <motion.button
                  key={index}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => startChat(option)}
                  className="p-4 bg-gray-800 rounded-xl hover:bg-gray-700 transition-colors text-sm font-medium shadow-md"
                >
                  {option}
                </motion.button>
              ))}
            </div>
          )}
          <form onSubmit={handleSubmit} className="flex items-center">
            <motion.input
              whileFocus={{ scale: 1.02 }}
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask a question"
              className="flex-grow p-4 rounded-l-xl bg-gray-800 text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 border border-gray-700 shadow-inner"
            />
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              type="button"
              onClick={toggleListening}
              className="p-4 bg-gray-800 hover:bg-gray-700 transition-colors text-sm font-medium shadow-md mx-2"
            >
              {isListening ? (
                <FiStopCircle className="text-xl text-red-500" />
              ) : (
                <FiMic className="text-xl" />
              )}
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              type="submit"
              className="p-4 rounded-r-xl bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors shadow-md"
            >
              <FiSend className="text-xl" />
            </motion.button>
          </form>
        </motion.div>

        {/* Audio interaction circle */}
        <div className="fixed bottom-8 right-8">
          <div
            id="waveform"
            className="w-16 h-16 rounded-full bg-indigo-600 flex items-center justify-center cursor-pointer"
            onClick={() => setIsPlaying(!isPlaying)}
          >
            {isPlaying ? (
              <FiStopCircle className="text-xl text-white" />
            ) : (
              <FiVolume2 className="text-xl text-white" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatStream;
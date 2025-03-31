import ChatbotIcon from "./ChatbotIcon";

const ChatMessage = ({ chat }) => {
  return (
    !chat.hideInChat && (
    <div className={chat.role === "model" ? "message bot-message" : "message user-message"}>
      {chat.role === "model" && <ChatbotIcon />}
      <p className="message-text">{chat.text}</p>
    </div>
    )
  );
};

export default ChatMessage;
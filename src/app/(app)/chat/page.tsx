import { Chat } from "@/components/chat";

export default function ChatPage() {
  return (
    <div className="flex-1 flex flex-col h-[calc(100dvh-5rem)] md:h-dvh">
      <div className="px-4 md:px-8 pt-6 max-w-2xl w-full mx-auto">
        <h1 className="text-xl font-semibold tracking-tight">Chat</h1>
      </div>
      <Chat suggestions={["Add a lead", "What's on the calendar tomorrow?", "Teach you something about how we work", "Show me estimates waiting on customers"]} />
    </div>
  );
}

import React, { useState } from 'react';
import { useListMessages, useOrchestratorChat } from '@workspace/api-client-react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Send, Bot, User } from 'lucide-react';

export default function Chat() {
  const [message, setMessage] = useState('');
  const { mutate: sendMessage, isPending } = useOrchestratorChat();
  const [localMessages, setLocalMessages] = useState<Array<{role: string, content: string}>>([
    { role: 'assistant', content: 'Hello. I am your Executive Assistant. How can I help you manage FounderOS today?' }
  ]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return;

    const newMsg = { role: 'user', content: message };
    setLocalMessages(prev => [...prev, newMsg]);
    
    sendMessage(
      { data: { message } },
      {
        onSuccess: (data) => {
          setLocalMessages(prev => [...prev, { role: 'assistant', content: data.reply }]);
        }
      }
    );
    setMessage('');
  };

  return (
    <div className="h-full flex flex-col max-w-4xl mx-auto py-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight mb-2">Executive Assistant</h1>
        <p className="text-muted-foreground">Your AI co-pilot for running the company.</p>
      </div>

      <Card className="flex-1 flex flex-col bg-card/50 border-border/50 overflow-hidden">
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {localMessages.map((msg, i) => (
            <div key={i} className={`flex gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                msg.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground border border-border'
              }`}>
                {msg.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
              </div>
              <div className={`max-w-[80%] rounded-lg p-4 ${
                msg.role === 'user' 
                  ? 'bg-primary text-primary-foreground rounded-tr-none' 
                  : 'bg-secondary/50 text-foreground border border-border/50 rounded-tl-none'
              }`}>
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
              </div>
            </div>
          ))}
          {isPending && (
            <div className="flex gap-4">
              <div className="w-8 h-8 rounded-full bg-secondary text-secondary-foreground border border-border flex items-center justify-center shrink-0">
                <Bot className="w-4 h-4" />
              </div>
              <div className="bg-secondary/50 border border-border/50 rounded-lg rounded-tl-none p-4 flex items-center gap-1">
                <span className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          )}
        </div>
        
        <div className="p-4 border-t border-border/50 bg-background/50 backdrop-blur">
          <form onSubmit={handleSend} className="flex gap-2 relative">
            <Input 
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Ask me anything..." 
              className="bg-card border-border/50 focus-visible:ring-primary"
              disabled={isPending}
            />
            <Button type="submit" disabled={isPending || !message.trim()}>
              <Send className="w-4 h-4" />
            </Button>
          </form>
        </div>
      </Card>
    </div>
  );
}

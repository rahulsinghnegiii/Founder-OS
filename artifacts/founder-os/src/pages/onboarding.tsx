import React, { useState } from 'react';
import { useGetOnboarding, useUpdateOnboarding } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useLocation } from 'wouter';
import { CheckCircle2, Circle } from 'lucide-react';

const STEPS = [
  { id: 'welcome', title: 'Welcome to FounderOS', desc: 'Initialize your digital command center.' },
  { id: 'profile', title: 'Company Profile', desc: 'Set up your core business details.' },
  { id: 'agents', title: 'Initialize Agents', desc: 'Boot up your autonomous workforce.' },
  { id: 'complete', title: 'Ready', desc: 'Your OS is configured and ready.' }
];

export default function Onboarding() {
  const { data: onboarding } = useGetOnboarding();
  const { mutate: updateOnboarding, isPending } = useUpdateOnboarding();
  const [, setLocation] = useLocation();

  const currentStepId = onboarding?.currentStep || 'welcome';
  const currentIndex = STEPS.findIndex(s => s.id === currentStepId);

  const handleNext = () => {
    if (currentIndex < STEPS.length - 1) {
      updateOnboarding({ data: { currentStep: STEPS[currentIndex + 1].id } });
    } else {
      updateOnboarding({ data: { completedAt: new Date().toISOString() } }, {
        onSuccess: () => setLocation('/')
      });
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="max-w-3xl w-full grid grid-cols-1 md:grid-cols-3 gap-8">
        
        {/* Sidebar steps */}
        <div className="space-y-6">
          <div className="flex items-center gap-2 mb-8">
            <div className="w-8 h-8 bg-primary rounded-md flex items-center justify-center text-primary-foreground font-bold">
              F
            </div>
            <span className="font-bold text-lg tracking-tight">FounderOS</span>
          </div>

          <div className="space-y-4 relative before:absolute before:inset-0 before:ml-[11px] before:h-full before:w-px before:bg-border/50">
            {STEPS.map((step, idx) => {
              const isCompleted = idx < currentIndex;
              const isCurrent = idx === currentIndex;
              
              return (
                <div key={step.id} className="relative flex items-start gap-4">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 z-10 bg-background ${
                    isCompleted ? 'text-primary' : isCurrent ? 'border-2 border-primary text-primary' : 'border-2 border-border text-muted-foreground'
                  }`}>
                    {isCompleted ? <CheckCircle2 className="w-6 h-6" /> : <span className="text-xs font-medium">{idx + 1}</span>}
                  </div>
                  <div className="pt-0.5">
                    <h3 className={`text-sm font-medium ${isCurrent ? 'text-foreground' : 'text-muted-foreground'}`}>
                      {step.title}
                    </h3>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Main content */}
        <div className="md:col-span-2">
          <Card className="bg-card border-border/50 h-[400px] flex flex-col relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-primary/50 to-primary/10" />
            <CardHeader>
              <CardTitle>{STEPS[currentIndex]?.title}</CardTitle>
              <CardDescription>{STEPS[currentIndex]?.desc}</CardDescription>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col justify-center items-center text-center p-8">
              <div className="w-24 h-24 rounded-full bg-secondary/50 border border-border flex items-center justify-center mb-6">
                <div className="w-16 h-16 rounded-full bg-primary/20 animate-pulse flex items-center justify-center">
                  <div className="w-8 h-8 rounded-full bg-primary" />
                </div>
              </div>
              <p className="text-muted-foreground">
                Setting up environment parameters and initializing data structures for {STEPS[currentIndex]?.title.toLowerCase()}...
              </p>
            </CardContent>
            <div className="p-6 border-t border-border/50 flex justify-end bg-secondary/10">
              <Button onClick={handleNext} disabled={isPending}>
                {currentIndex === STEPS.length - 1 ? 'Enter Command Center' : 'Continue'}
              </Button>
            </div>
          </Card>
        </div>

      </div>
    </div>
  );
}

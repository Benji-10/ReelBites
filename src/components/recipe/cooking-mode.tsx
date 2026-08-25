'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight, X, Maximize2, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EvidenceTooltip } from './evidence-tooltip';
import type { RecipeInstruction } from '@/lib/types';

interface CookingModeProps {
  instructions: RecipeInstruction[];
  title: string;
  onClose: () => void;
}

export function CookingMode({ instructions, title, onClose }: CookingModeProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());

  const step = instructions[currentStep];
  const isLastStep = currentStep === instructions.length - 1;
  const isCompleted = completedSteps.has(currentStep);

  function toggleCompleted() {
    const next = new Set(completedSteps);
    if (next.has(currentStep)) {
      next.delete(currentStep);
    } else {
      next.add(currentStep);
    }
    setCompletedSteps(next);
  }

  function next() {
    if (!isLastStep) {
      setCurrentStep(currentStep + 1);
    }
  }

  function prev() {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Cooking Mode</p>
          <h2 className="font-semibold truncate">{title}</h2>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} className="shrink-0">
          <X className="h-5 w-5" />
        </Button>
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-muted">
        <div
          className="h-full bg-primary transition-all duration-300"
          style={{ width: `${((currentStep + 1) / instructions.length) * 100}%` }}
        />
      </div>

      {/* Step indicator */}
      <div className="flex items-center justify-center gap-2 py-3 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">Step {currentStep + 1}</span>
        <span>of</span>
        <span>{instructions.length}</span>
        {completedSteps.size > 0 && (
          <span className="ml-2 text-xs">
            ({completedSteps.size} completed)
          </span>
        )}
      </div>

      {/* Main content — the instruction */}
      <div className="flex-1 flex items-center justify-center p-6 overflow-hidden">
        <div className="max-w-2xl w-full text-center space-y-6">
          <div className="text-6xl sm:text-7xl font-bold text-primary/20 tabular-nums">
            {currentStep + 1}
          </div>
          <p className="text-xl sm:text-2xl leading-relaxed font-medium">
            {step.step}
          </p>
          <div className="flex items-center justify-center gap-2">
            <EvidenceTooltip evidence={step.evidence} flag={step.flag} />
            {step.flag && (
              <span className="text-xs text-amber-500">
                {step.flag === 'missing_amount' ? 'Estimated' : 'May need verification'}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="border-t border-border p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <Button
            variant="outline"
            onClick={prev}
            disabled={currentStep === 0}
            className="gap-1.5"
          >
            <ChevronLeft className="h-4 w-4" />
            Previous
          </Button>

          <Button
            variant={isCompleted ? 'default' : 'outline'}
            onClick={toggleCompleted}
            className="gap-1.5"
          >
            <Check className="h-4 w-4" />
            {isCompleted ? 'Completed' : 'Mark complete'}
          </Button>

          {isLastStep ? (
            <Button onClick={onClose} className="gap-1.5">
              <Check className="h-4 w-4" />
              Finish
            </Button>
          ) : (
            <Button onClick={next} className="gap-1.5">
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          )}
        </div>

        {/* Step dots */}
        <div className="flex items-center justify-center gap-1.5">
          {instructions.map((_, i) => (
            <button
              key={i}
              onClick={() => setCurrentStep(i)}
              className={`h-2 rounded-full transition-all ${
                i === currentStep
                  ? 'w-8 bg-primary'
                  : completedSteps.has(i)
                    ? 'w-2 bg-primary/40'
                    : 'w-2 bg-muted-foreground/30'
              }`}
              aria-label={`Go to step ${i + 1}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

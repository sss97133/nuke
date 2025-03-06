import React from 'react';

interface HeadingWithDescriptionProps {
  heading: string;
  description: string;
}

export function HeadingWithDescription({ heading, description }: HeadingWithDescriptionProps) {
  return (
    <div className="space-y-2">
      <h1 className="text-3xl font-bold tracking-tight">{heading}</h1>
      <p className="text-muted-foreground">{description}</p>
    </div>
  );
} 
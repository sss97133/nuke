
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";

export const AIExplanations = () => {
  const [question, setQuestion] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const { toast } = useToast();

  // Fetch existing explanations
  const { data: explanations, refetch } = useQuery({
    queryKey: ['ai-explanations'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ai_explanations')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data;
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim()) return;

    setIsGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-explanation', {
        body: { question: question.trim() }
      });

      if (error) throw error;

      await refetch();
      setQuestion("");
      toast({
        title: "Explanation Generated",
        description: "Your explanation has been generated and saved.",
      });
    } catch (error) {
      console.error('Error generating explanation:', error);
      toast({
        title: "Error",
        description: "Failed to generate explanation. Please try again.",
        variant: "destructive"
      });
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="container mx-auto py-6 max-w-4xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>AI Explanations</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex gap-2 mb-6">
            <Input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask a question..."
              className="flex-1"
              disabled={isGenerating}
            />
            <Button type="submit" disabled={isGenerating}>
              {isGenerating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Generating...
                </>
              ) : (
                "Get Explanation"
              )}
            </Button>
          </form>

          <div className="space-y-4">
            {explanations?.map((item) => (
              <Card key={item.id} className="p-4">
                <div className="space-y-2">
                  <h3 className="font-medium">{item.question}</h3>
                  <p className="text-muted-foreground">{item.explanation}</p>
                  <div className="text-xs text-muted-foreground">
                    Generated using {item.model} on{" "}
                    {new Date(item.created_at).toLocaleDateString()}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};


import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useToast } from "@/components/ui/use-toast"
import { supabase } from "@/integrations/supabase/client"
import { Loader2 } from "lucide-react"

export const MendableChat = () => {
  const [query, setQuery] = useState("")
  const [response, setResponse] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const { toast } = useToast()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!query.trim()) return

    setIsLoading(true)
    try {
      const { data, error } = await supabase.functions.invoke('query-mendable', {
  if (error) console.error("Database query error:", error);
        body: { query: query.trim() }
      })

      if (error) {
        console.error('Supabase function error:', error)
        throw new Error(error.message)
      }

      if (!data?.answer) {
        throw new Error('No answer received from AI')
      }

      setResponse(data.answer)
      setQuery("")
    } catch (error) {
      console.error('Error querying Mendable:', error)
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to get response from AI. Please try again.",
        variant: "destructive"
      })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="border border-gov-blue p-4 rounded-lg space-y-4">
      <div className="text-sm font-mono text-muted-foreground">
        AI_ASSISTANT
      </div>
      
      {response && (
        <div className="bg-muted p-4 rounded text-sm">
          {response}
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ask about your vehicle or inventory..."
          className="flex-1"
          disabled={isLoading}
        />
        <Button type="submit" disabled={isLoading}>
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Ask"}
        </Button>
      </form>
    </div>
  )
}

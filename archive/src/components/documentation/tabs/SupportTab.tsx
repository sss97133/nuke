
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HelpCircle, ArrowLeft } from 'lucide-react';

const SUPPORT_CONTENT = `
# Support Resources

## Getting Help

Our support team is here to help you with any questions or issues you may have with the platform.

## Contact Methods

- Email: support@vehicleplatform.com
- Phone: +1 (555) 123-4567
- Live Chat: Available on the dashboard from 9am-5pm EST

## Troubleshooting

Before contacting support, you might want to try these common troubleshooting steps:

1. Clear your browser cache
2. Ensure you're using a supported browser (Chrome, Firefox, Edge, Safari)
3. Check our status page for any ongoing issues
4. Try logging out and back in
5. Verify your internet connection

## FAQs

### How do I reset my password?
Click on the "Forgot Password" link on the login page.

### Can I export my vehicle data?
Yes, you can export your data in CSV or PDF format from the dashboard.

### Is my data secure?
Yes, we use industry-standard encryption and security practices to protect your data.
`;

export const SupportTab = () => {
  const [showSupportDocs, setShowSupportDocs] = useState(false);

  if (showSupportDocs) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <HelpCircle className="h-5 w-5 text-blue-500" />
            <CardTitle>Support Resources</CardTitle>
          </div>
          <button 
            onClick={() => setShowSupportDocs(false)}
            className="flex items-center gap-1 text-sm text-blue-500 hover:text-blue-700"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to overview
          </button>
        </CardHeader>
        <CardContent>
          <div className="prose dark:prose-invert max-w-none">
            {SUPPORT_CONTENT.split('\n').map((paragraph, index) => {
              // Handle headers
              if (paragraph.startsWith('# ')) {
                return <h1 key={index} className="text-2xl font-bold mt-6 mb-4">{paragraph.replace('# ', '')}</h1>;
              }
              if (paragraph.startsWith('## ')) {
                return <h2 key={index} className="text-xl font-bold mt-5 mb-3">{paragraph.replace('## ', '')}</h2>;
              }
              if (paragraph.startsWith('### ')) {
                return <h3 key={index} className="text-lg font-bold mt-4 mb-2">{paragraph.replace('### ', '')}</h3>;
              }
              // Handle lists
              if (paragraph.startsWith('- ')) {
                return <li key={index} className="ml-6 mb-1">{paragraph.replace('- ', '')}</li>;
              }
              if (paragraph.match(/^\d+\./)) {
                return <li key={index} className="ml-6 mb-1">{paragraph.replace(/^\d+\./, '').trim()}</li>;
              }
              // Handle code blocks (simple version)
              if (paragraph.startsWith('```')) {
                return null; // Skip the code block delimiters
              }
              if (paragraph.trim() === '') {
                return <br key={index} />;
              }
              // Regular paragraphs
              return <p key={index} className="mb-4">{paragraph}</p>;
            })}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-center p-10">
          <HelpCircle className="h-10 w-10 mx-auto mb-4 text-muted-foreground" />
          <h3 className="text-xl font-medium mb-2">Support Resources</h3>
          <p className="text-muted-foreground mb-6 max-w-md mx-auto">
            Get help, submit tickets, and connect with our support team
          </p>
          <div className="flex justify-center gap-4">
            <button 
              className="bg-primary text-primary-foreground px-4 py-2 rounded-md"
              onClick={() => setShowSupportDocs(true)}
            >
              View Support Resources
            </button>
            <button className="border border-input bg-background hover:bg-accent hover:text-accent-foreground px-4 py-2 rounded-md">
              Troubleshooting Guide
            </button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

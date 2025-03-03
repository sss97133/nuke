
import React, { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ContentEntryForm } from '@/components/explore/ContentEntryForm';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const ExploreContentManagement = () => {
  return (
    <div className="container max-w-5xl p-6">
      <div className="space-y-2 mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Explore Content Management</h1>
        <p className="text-muted-foreground">
          Add and manage content that appears in the Explore feed
        </p>
      </div>
      
      <Tabs defaultValue="add">
        <TabsList className="mb-4">
          <TabsTrigger value="add">Add Content</TabsTrigger>
          <TabsTrigger value="manage">Manage Content</TabsTrigger>
        </TabsList>
        
        <TabsContent value="add">
          <Card>
            <CardHeader>
              <CardTitle>Add New Content</CardTitle>
              <CardDescription>
                Create a new item that will appear in the Explore feeds
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ContentEntryForm />
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="manage">
          <Card>
            <CardHeader>
              <CardTitle>Manage Existing Content</CardTitle>
              <CardDescription>
                View, edit, and delete existing content items
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-center py-8 text-muted-foreground">
                Content management interface will be implemented in a future update.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ExploreContentManagement;


import React, { useState } from 'react';
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Upload, FileText, Database, Globe, Image, RefreshCcw,
  Check, AlertCircle, FileSpreadsheet, UploadCloud
} from 'lucide-react';

const ImportPage = () => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [importStatus, setImportStatus] = useState<'idle' | 'processing' | 'success' | 'error'>('idle');
  
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
    }
  };
  
  const handleImport = () => {
    if (selectedFile) {
      setImportStatus('processing');
      
      // Simulate processing
      setTimeout(() => {
        setImportStatus(Math.random() > 0.2 ? 'success' : 'error');
      }, 2000);
    }
  };
  
  const resetImport = () => {
    setSelectedFile(null);
    setImportStatus('idle');
  };
  
  return (
    <ScrollArea className="h-[calc(100vh-4rem)]">
      <div className="container max-w-7xl p-6 space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Import</h1>
          <p className="text-muted-foreground">
            Import data from various sources into your system
          </p>
        </div>
        
        <Tabs defaultValue="file">
          <TabsList className="mb-4">
            <TabsTrigger value="file">File Import</TabsTrigger>
            <TabsTrigger value="web">Web Import</TabsTrigger>
            <TabsTrigger value="api">API Connection</TabsTrigger>
            <TabsTrigger value="scan">Document Scan</TabsTrigger>
          </TabsList>
          
          <TabsContent value="file">
            <div className="grid gap-6 md:grid-cols-3">
              <div className="md:col-span-2">
                <Card>
                  <CardHeader>
                    <CardTitle>Import Data File</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {importStatus === 'idle' && (
                      <>
                        <div className="border-2 border-dashed rounded-lg p-6 text-center">
                          {!selectedFile ? (
                            <>
                              <UploadCloud className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
                              <h3 className="font-medium mb-1">Drag and drop your file</h3>
                              <p className="text-sm text-muted-foreground mb-4">
                                Or click to browse for a file
                              </p>
                              <Input
                                type="file"
                                className="hidden"
                                id="file-upload"
                                onChange={handleFileChange}
                                accept=".csv,.xlsx,.json,.xml"
                              />
                              <Label htmlFor="file-upload" className="cursor-pointer">
                                <Button variant="outline" type="button">
                                  <Upload className="h-4 w-4 mr-2" />
                                  Browse Files
                                </Button>
                              </Label>
                            </>
                          ) : (
                            <div className="space-y-2">
                              <FileText className="h-8 w-8 text-primary mx-auto mb-2" />
                              <h3 className="font-medium">{selectedFile.name}</h3>
                              <p className="text-sm text-muted-foreground">
                                {(selectedFile.size / 1024).toFixed(2)} KB
                              </p>
                              <Button variant="outline" size="sm" onClick={resetImport}>
                                Choose Different File
                              </Button>
                            </div>
                          )}
                        </div>
                        
                        <div className="space-y-4">
                          <div className="space-y-2">
                            <Label htmlFor="import-type">Import Type</Label>
                            <Select defaultValue="vehicles">
                              <SelectTrigger>
                                <SelectValue placeholder="Select import type" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="vehicles">Vehicles</SelectItem>
                                <SelectItem value="inventory">Inventory</SelectItem>
                                <SelectItem value="customers">Customers</SelectItem>
                                <SelectItem value="services">Service Records</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          
                          <div className="space-y-2">
                            <Label htmlFor="mapping">Field Mapping</Label>
                            <Select defaultValue="auto">
                              <SelectTrigger>
                                <SelectValue placeholder="Select mapping method" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="auto">Auto-detect</SelectItem>
                                <SelectItem value="manual">Manual Mapping</SelectItem>
                                <SelectItem value="template">Use Template</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          
                          <div className="space-y-2">
                            <Label htmlFor="conflict">Conflict Resolution</Label>
                            <Select defaultValue="skip">
                              <SelectTrigger>
                                <SelectValue placeholder="Select conflict handling" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="skip">Skip Duplicates</SelectItem>
                                <SelectItem value="overwrite">Overwrite Existing</SelectItem>
                                <SelectItem value="merge">Merge Records</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </>
                    )}
                    
                    {importStatus === 'processing' && (
                      <div className="text-center py-6">
                        <RefreshCcw className="h-10 w-10 text-primary mx-auto mb-4 animate-spin" />
                        <h3 className="font-medium mb-1">Processing Import</h3>
                        <p className="text-sm text-muted-foreground">
                          Please wait while we import your data...
                        </p>
                      </div>
                    )}
                    
                    {importStatus === 'success' && (
                      <div className="text-center py-6">
                        <Check className="h-10 w-10 text-green-500 mx-auto mb-4" />
                        <h3 className="font-medium mb-1">Import Successful</h3>
                        <p className="text-sm text-muted-foreground mb-4">
                          Your data has been successfully imported
                        </p>
                        <Button onClick={resetImport}>Import Another File</Button>
                      </div>
                    )}
                    
                    {importStatus === 'error' && (
                      <div className="text-center py-6">
                        <AlertCircle className="h-10 w-10 text-destructive mx-auto mb-4" />
                        <h3 className="font-medium mb-1">Import Failed</h3>
                        <p className="text-sm text-muted-foreground mb-4">
                          There was an error importing your data. Please try again.
                        </p>
                        <Button onClick={resetImport}>Try Again</Button>
                      </div>
                    )}
                  </CardContent>
                  {importStatus === 'idle' && selectedFile && (
                    <CardFooter className="border-t px-6 py-4">
                      <Button onClick={handleImport} className="ml-auto">
                        Start Import
                      </Button>
                    </CardFooter>
                  )}
                </Card>
              </div>
              
              <div className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Supported File Types</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {[
                        { icon: <FileSpreadsheet className="h-4 w-4 text-green-500" />, format: "CSV", desc: "Comma Separated Values" },
                        { icon: <FileSpreadsheet className="h-4 w-4 text-blue-500" />, format: "XLSX", desc: "Excel Spreadsheet" },
                        { icon: <FileText className="h-4 w-4 text-orange-500" />, format: "JSON", desc: "JavaScript Object Notation" },
                        { icon: <FileText className="h-4 w-4 text-purple-500" />, format: "XML", desc: "Extensible Markup Language" }
                      ].map((file, index) => (
                        <div key={index} className="flex items-center gap-2 p-2">
                          {file.icon}
                          <div>
                            <h4 className="font-medium">{file.format}</h4>
                            <p className="text-xs text-muted-foreground">{file.desc}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
                
                <Card>
                  <CardHeader>
                    <CardTitle>Import History</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {[
                        { file: "vehicles-may.csv", date: "May 10, 2024", records: 45 },
                        { file: "inventory-q1.xlsx", date: "Apr 02, 2024", records: 128 },
                        { file: "services-2023.json", date: "Mar 15, 2024", records: 312 }
                      ].map((item, index) => (
                        <div key={index} className="border-l-2 border-primary pl-3 py-1">
                          <div className="flex justify-between">
                            <h4 className="font-medium text-sm">{item.file}</h4>
                            <span className="text-xs text-muted-foreground">{item.date}</span>
                          </div>
                          <p className="text-xs text-muted-foreground">{item.records} records</p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>
          
          <TabsContent value="web">
            <Card>
              <CardHeader>
                <CardTitle>Import from Website</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="url">Website URL</Label>
                  <div className="flex gap-2">
                    <Input id="url" placeholder="https://example.com/data-source" />
                    <Button type="button">Fetch</Button>
                  </div>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="selector">Data Selector (CSS/XPath)</Label>
                  <Input id="selector" placeholder="table.data-table or //table[@class='data-table']" />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="auth">Authentication (Optional)</Label>
                  <Textarea id="auth" placeholder="API key or auth details if required" />
                </div>
              </CardContent>
              <CardFooter className="border-t px-6 py-4">
                <Button className="ml-auto">
                  <Globe className="h-4 w-4 mr-2" />
                  Start Web Import
                </Button>
              </CardFooter>
            </Card>
          </TabsContent>
          
          <TabsContent value="api">
            <Card>
              <CardHeader>
                <CardTitle>API Connection</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="api-url">API Endpoint URL</Label>
                  <Input id="api-url" placeholder="https://api.example.com/v1/resources" />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="method">Request Method</Label>
                  <Select defaultValue="GET">
                    <SelectTrigger>
                      <SelectValue placeholder="Select request method" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="GET">GET</SelectItem>
                      <SelectItem value="POST">POST</SelectItem>
                      <SelectItem value="PUT">PUT</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="api-key">API Key/Token</Label>
                  <Input id="api-key" placeholder="Your API key or token" type="password" />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="headers">Headers (JSON)</Label>
                  <Textarea id="headers" placeholder='{"Content-Type": "application/json", "Accept": "application/json"}' />
                </div>
              </CardContent>
              <CardFooter className="border-t px-6 py-4">
                <Button className="ml-auto">
                  <Database className="h-4 w-4 mr-2" />
                  Connect API
                </Button>
              </CardFooter>
            </Card>
          </TabsContent>
          
          <TabsContent value="scan">
            <Card>
              <CardHeader>
                <CardTitle>Document Scanning</CardTitle>
              </CardHeader>
              <CardContent className="py-6">
                <div className="text-center py-6">
                  <Image className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
                  <h3 className="font-medium mb-1">Scan Documents</h3>
                  <p className="text-sm text-muted-foreground mb-6">
                    Use your camera to scan documents and extract data
                  </p>
                  <div className="flex justify-center gap-4">
                    <Button>
                      <Camera className="h-4 w-4 mr-2" />
                      Open Camera
                    </Button>
                    <Button variant="outline">
                      <Upload className="h-4 w-4 mr-2" />
                      Upload Image
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </ScrollArea>
  );
};

export default ImportPage;

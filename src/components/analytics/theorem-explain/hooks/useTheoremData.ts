
import { useState, useEffect } from 'react';
import { TheoremData } from '../types';

export const useTheoremData = () => {
  const [theoremData, setTheoremData] = useState<TheoremData[]>([]);
  const [selectedTheorem, setSelectedTheorem] = useState<TheoremData | undefined>(undefined);
  const [fetchingData, setFetchingData] = useState(false);

  // Fetch data from Hugging Face dataset
  useEffect(() => {
    const fetchTheoremData = async () => {
      try {
        setFetchingData(true);
        // Log the fetch attempt
        console.log("Fetching theorem data from HuggingFace...");
        
        const response = await fetch(
          "https://datasets-server.huggingface.co/rows?dataset=TIGER-Lab%2FTheoremExplainBench&config=default&split=train&offset=0&length=5"
        );
        
        if (!response.ok) {
          throw new Error(`Failed to fetch data: ${response.status}`);
        }
        
        const data = await response.json();
        console.log("Data received:", data);
        
        // Transform the data into our format
        if (data && data.rows) {
          const transformedData: TheoremData[] = data.rows.map((row: any) => ({
            id: row.row_idx.toString(),
            name: row.row.theorem_name || "Unnamed Theorem",
            definition: row.row.theorem_statement || "No definition available",
            explanation: row.row.explanation || undefined,
            category: row.row.category || undefined
          }));
          
          console.log("Transformed data:", transformedData);
          setTheoremData(transformedData);
          
          // Set the first theorem as selected
          if (transformedData.length > 0) {
            console.log("Setting selected theorem:", transformedData[0]);
            setSelectedTheorem(transformedData[0]);
          }
        } else {
          console.error("No rows found in data:", data);
        }
      } catch (error) {
        console.error("Error fetching theorem data:", error);
      } finally {
        setFetchingData(false);
      }
    };
    
    fetchTheoremData();
  }, []);

  // Debug output whenever selectedTheorem changes
  useEffect(() => {
    console.log("Selected theorem changed:", selectedTheorem);
  }, [selectedTheorem]);

  return {
    theoremData,
    selectedTheorem,
    setSelectedTheorem,
    fetchingData
  };
};

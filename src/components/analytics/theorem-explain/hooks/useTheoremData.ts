
import { useState, useEffect } from 'react';
import { TheoremData } from '../types';

/**
 * Custom hook to fetch and manage theorem data from the Hugging Face dataset
 * 
 * This hook handles fetching theorem data from the TIGER-Lab/TheoremExplainBench
 * dataset, transforming the response into our application's format, and managing
 * the selected theorem state.
 * 
 * The hook automatically fetches data on mount and selects the first theorem
 * by default when data is available.
 * 
 * @returns {Object} Object containing theorem data and selection state
 * @returns {Array<TheoremData>} theoremData - Array of all fetched theorems
 * @returns {TheoremData | undefined} selectedTheorem - The currently selected theorem
 * @returns {Function} setSelectedTheorem - Function to update the selected theorem
 * @returns {boolean} fetchingData - Whether data is currently being fetched
 */
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

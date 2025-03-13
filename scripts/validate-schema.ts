import {
  createClient,
  SupabaseClient,
  PostgrestError,
} from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname } from "path";

// Get current file's directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config();

// Minimal type definition for Database
type Database = {
  public: {
    Tables: {
      team_members: {
        Row: {
          id: string;
          status: string;
          profile_id: string;
          member_type: string;
        };
      };
      profiles: {
        Row: {
          id: string;
          email: string;
          created_at: string;
        };
      };
      vehicles: {
        Row: {
          id: string;
          vin: string;
          status: string;
          created_at: string;
        };
      };
    };
    Functions: {
      get_table_columns: {
        Args: { table_name: string };
        Returns: TableColumn[];
      };
      execute_sql: {
        Args: { sql: string };
        Returns: unknown;
      };
    };
  };
};

interface TableColumn {
  column_name: string;
  data_type: string;
  is_nullable: boolean;
}

interface RequiredSchema {
  [key: string]: string[];
}

class SchemaValidationError extends Error {
  constructor(
    message: string,
    public tableName?: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "SchemaValidationError";
  }
}

class SchemaValidator {
  private client: SupabaseClient<Database, "public">;
  private logger: typeof console;

  constructor(url: string, key: string, logger = console) {
    this.client = createClient<Database>(url, key);
    this.logger = logger;
  }

  protected async validateTable(
    tableName: string,
    requiredColumns: string[],
  ): Promise<void> {
    // Query to get a single row (limit 0) just to validate structure
    const { error: tableError } = await this.client
      .from(tableName)
      .select("*")
      .limit(0);

    if (tableError) {
      throw new SchemaValidationError(
        `Error accessing table: ${tableError.message}`,
        tableName,
        tableError,
      );
    }

    // Validate columns by checking table information
    const { data: columnsData, error: columnsError } = await this.client.rpc(
      "get_table_columns",
      {
        table_name: tableName,
      },
    );

    if (columnsError) {
      // If RPC is not available, create it
      if (columnsError.message.includes("does not exist")) {
        this.logger.warn(
          "⚠️ get_table_columns RPC function not found, creating it...",
        );
        await this.createTableColumnsFunction();

        // Try again
        const { data: retryData, error: retryError } = await this.client.rpc(
          "get_table_columns",
          {
            table_name: tableName,
          },
        );

        if (retryError) {
          throw new SchemaValidationError(
            `Failed to create and use get_table_columns function: ${retryError.message}`,
            tableName,
            retryError,
          );
        }

        if (!retryData || !Array.isArray(retryData) || retryData.length === 0) {
          throw new SchemaValidationError(
            "Table appears to be empty or does not exist",
            tableName,
          );
        }

        // Get actual column names from the retry data
        const actualColumns = (retryData as TableColumn[]).map(
          (col) => col.column_name,
        );

        // Check missing columns
        const missingColumns = requiredColumns.filter(
          (col) => !actualColumns.includes(col),
        );

        if (missingColumns.length > 0) {
          throw new SchemaValidationError(
            `Missing required columns: ${missingColumns.join(", ")}`,
            tableName,
          );
        }

        return; // Validation successful after retry
      }

      // Some other error occurred
      throw new SchemaValidationError(
        `Error getting columns: ${columnsError.message}`,
        tableName,
        columnsError,
      );
    }

    if (
      !columnsData ||
      !Array.isArray(columnsData) ||
      columnsData.length === 0
    ) {
      throw new SchemaValidationError(
        "Table appears to be empty or does not exist",
        tableName,
      );
    }

    // Get actual column names
    const actualColumns = (columnsData as TableColumn[]).map(
      (col) => col.column_name,
    );

    // Check missing columns
    const missingColumns = requiredColumns.filter(
      (col) => !actualColumns.includes(col),
    );

    if (missingColumns.length > 0) {
      throw new SchemaValidationError(
        `Missing required columns: ${missingColumns.join(", ")}`,
        tableName,
      );
    }
  }

  private async createTableColumnsFunction(): Promise<void> {
    // Create the get_table_columns function directly
    const { error: createError } = await this.client.rpc("execute_sql", {
      sql: /* SQL */ `
      CREATE OR REPLACE FUNCTION get_table_columns(table_name TEXT)
      RETURNS TABLE (
        column_name TEXT,
        data_type TEXT,
        is_nullable BOOLEAN
      )
      SECURITY DEFINER
      AS $$
      BEGIN
        RETURN QUERY
        SELECT
          c.column_name::TEXT,
          c.data_type::TEXT,
          (c.is_nullable = 'YES')::BOOLEAN
        FROM
          information_schema.columns c
        WHERE
          c.table_schema = 'public'
          AND c.table_name = $1;
      END;
      $$ LANGUAGE plpgsql;
      `,
    });

    if (createError) {
      throw new SchemaValidationError(
        `Failed to create database helper functions: ${createError.message}`,
        undefined,
        createError,
      );
    }
  }

  async validateSchema(): Promise<void> {
    this.logger.info("🔍 Starting database schema validation...");

    // List of critical tables and their required columns
    const requiredSchema: RequiredSchema = {
      team_members: ["id", "status", "profile_id", "member_type"],
      profiles: ["id", "email", "created_at"],
      vehicles: ["id", "vin", "status", "created_at"],
    };

    try {
      // Verify each table
      for (const [tableName, requiredColumns] of Object.entries(
        requiredSchema,
      )) {
        this.logger.info(`📋 Checking table: ${tableName}`);
        await this.validateTable(tableName, requiredColumns);

        this.logger.info(`✅ Table ${tableName} validated successfully`);
      }

      this.logger.info("✅ Database schema validation completed successfully");
    } catch (error) {
      if (error instanceof SchemaValidationError) {
        this.logger.error(
          `❌ Schema validation failed for ${error.tableName || "unknown table"}: ${error.message}`,
          error.details,
        );
      } else {
        this.logger.error(
          "❌ Unexpected error during schema validation:",
          error instanceof Error ? error.message : String(error),
        );
      }
      throw error;
    }
  }
}

// Mock implementation for test environment
class MockSchemaValidator extends SchemaValidator {
  private readonly mockSchema: RequiredSchema = {
    team_members: ["id", "status", "profile_id", "member_type"],
    profiles: ["id", "email", "created_at"],
    vehicles: ["id", "vin", "status", "created_at"],
  };

  constructor() {
    // In test environment, we use a mock client to avoid real database calls
    const mockClient = {
      rpc: (functionName: string, params?: { table_name?: string }) => {
        if (functionName === "get_table_columns" && params?.table_name) {
          const tableName = params.table_name;
          const columns = this.mockSchema[tableName] || [];
          return Promise.resolve({
            data: columns.map((name) => ({
              column_name: name,
              data_type: "text",
              is_nullable: false,
            })),
            error: null,
          });
        }
        return Promise.resolve({ data: [], error: null });
      },
      from: (tableName: string) => ({
        select: () => ({
          limit: () => {
            const exists = tableName in this.mockSchema;
            return Promise.resolve({
              data: exists ? [] : null,
              error: exists
                ? null
                : new Error(`Table ${tableName} does not exist`),
            });
          },
        }),
      }),
    } as unknown as SupabaseClient<Database>;

    super("http://localhost:54321", "test-service-key");
    // Override the client with our mock
    Object.defineProperty(this, "client", {
      value: mockClient,
      writable: false,
    });
  }

  async validateSchema(): Promise<void> {
    console.info("🔍 Starting mock schema validation...");

    try {
      // Simulate validation of each table
      for (const [tableName, columns] of Object.entries(this.mockSchema)) {
        console.info(`📋 Checking table: ${tableName}`);
        await this.validateTable(tableName, columns);

        console.info(
          `✅ Table ${tableName} validated successfully (${columns.length} columns)`,
        );
      }

      console.info("✅ Mock schema validation completed successfully");
    } catch (error) {
      console.error(
        "❌ Mock schema validation failed:",
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }
}

// Main execution
const main = async (): Promise<void> => {
  const ENV = process.env.NODE_ENV || "development";
  let validator: SchemaValidator;

  try {
    // Use mock validator in test environment
    if (ENV === "test") {
      validator = new MockSchemaValidator();
    } else {
      const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
      const SUPABASE_SERVICE_KEY = process.env.VITE_SUPABASE_SERVICE_KEY;

      if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        throw new Error(
          "❌ Missing required environment variables: VITE_SUPABASE_URL and VITE_SUPABASE_SERVICE_KEY",
        );
      }

      validator = new SchemaValidator(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    }

    await validator.validateSchema();

    console.info("✅ Schema validation completed successfully");
    process.exit(0);
  } catch (error) {
    console.error(
      "❌ Schema validation failed:",
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  }
};

// Handle unhandled promise rejections
process.on("unhandledRejection", (error: unknown) => {
  console.error(
    "❌ Unhandled promise rejection:",
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
});

// Run the script and properly handle any errors
Promise.resolve()
  .then(() => main())
  .catch((error) => {
    console.error(
      "❌ Fatal error:",
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  });

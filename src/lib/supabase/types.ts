// AVOID UPDATING THIS FILE DIRECTLY. It is automatically generated.
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      audit_rules_log: {
        Row: {
          created_at: string
          id: string
          message: string
          rule_key: string
          status: string
          trip_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          rule_key: string
          status: string
          trip_id: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          rule_key?: string
          status?: string
          trip_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_rules_log_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          amount: number
          audit_flags: string[]
          audit_justification: string | null
          audit_manual_checked: boolean
          audit_manual_checked_at: string | null
          audit_manual_checked_by_id: string | null
          audit_manual_checked_by_name: string | null
          audit_status: string
          category: string
          cnpj: string | null
          created_at: string
          file_name: string
          file_url: string
          id: string
          is_verified: boolean
          issue_date: string
          issue_time: string | null
          merchant_name: string
          ocr_raw_text: string | null
          trip_id: string | null
        }
        Insert: {
          amount?: number
          audit_flags?: string[]
          audit_justification?: string | null
          audit_manual_checked?: boolean
          audit_manual_checked_at?: string | null
          audit_manual_checked_by_id?: string | null
          audit_manual_checked_by_name?: string | null
          audit_status?: string
          category: string
          cnpj?: string | null
          created_at?: string
          file_name: string
          file_url?: string
          id?: string
          is_verified?: boolean
          issue_date: string
          issue_time?: string | null
          merchant_name: string
          ocr_raw_text?: string | null
          trip_id?: string | null
        }
        Update: {
          amount?: number
          audit_flags?: string[]
          audit_justification?: string | null
          audit_manual_checked?: boolean
          audit_manual_checked_at?: string | null
          audit_manual_checked_by_id?: string | null
          audit_manual_checked_by_name?: string | null
          audit_status?: string
          category?: string
          cnpj?: string | null
          created_at?: string
          file_name?: string
          file_url?: string
          id?: string
          is_verified?: boolean
          issue_date?: string
          issue_time?: string | null
          merchant_name?: string
          ocr_raw_text?: string | null
          trip_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expenses_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          full_name: string
          id: string
          is_active: boolean
          role: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string
          full_name?: string
          id: string
          is_active?: boolean
          role?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          is_active?: boolean
          role?: string
          updated_at?: string
        }
        Relationships: []
      }
      trips: {
        Row: {
          created_at: string
          destination: string
          end_date: string
          id: string
          motivo: string
          notes: string | null
          start_date: string
          status: string
          total_amount: number
          transport_type: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          destination: string
          end_date: string
          id?: string
          motivo?: string
          notes?: string | null
          start_date: string
          status?: string
          total_amount?: number
          transport_type: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          destination?: string
          end_date?: string
          id?: string
          motivo?: string
          notes?: string | null
          start_date?: string
          status?: string
          total_amount?: number
          transport_type?: string
          user_id?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_orphan_trips: {
        Args: { p_target_user_id?: string }
        Returns: number
      }
      ensure_my_profile: { Args: never; Returns: Json }
      is_admin: { Args: { p_user_id?: string }; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const


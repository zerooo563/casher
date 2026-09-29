/**
 * Supabase database types — schema representation for Phase 0 tables.
 *
 * HOW TO REGENERATE ONCE SUPABASE CLOUD IS CONNECTED:
 *   npx supabase gen types typescript --project-id <your-project-id> > src/types/database.ts
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      tenants: {
        Row: {
          id:         string
          name:       string
          slug:       string
          settings:   Json
          is_active:  boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?:        string
          name:       string
          slug:       string
          settings?:  Json
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?:        string
          name?:      string
          slug?:      string
          settings?:  Json
          is_active?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      tenant_users: {
        Row: {
          id:         string
          tenant_id:  string
          user_id:    string
          role_id:    string
          is_active:  boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?:        string
          tenant_id:  string
          user_id:    string
          role_id:    string
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          role_id?:   string
          is_active?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_users_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_users_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          }
        ]
      }
      roles: {
        Row: {
          id:          string
          tenant_id:   string | null
          name:        string
          description: string | null
          is_system:   boolean
          created_at:  string
          updated_at:  string
        }
        Insert: {
          id?:         string
          tenant_id?:  string | null
          name:        string
          description?: string | null
          is_system?:  boolean
        }
        Update: {
          name?:        string
          description?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "roles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          }
        ]
      }
      permissions: {
        Row: {
          id:          string
          name:        string
          description: string | null
          module:      string
        }
        Insert: {
          id?:         string
          name:        string
          description?: string | null
          module:      string
        }
        Update: {
          description?: string | null
        }
        Relationships: []
      }
      role_permissions: {
        Row: {
          role_id:       string
          permission_id: string
        }
        Insert: {
          role_id:       string
          permission_id: string
        }
        Update: Record<string, never>
        Relationships: [
          {
            foreignKeyName: "role_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_permissions_permission_id_fkey"
            columns: ["permission_id"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["id"]
          }
        ]
      }
      branches: {
        Row: {
          id:         string
          tenant_id:  string
          name:       string
          name_ar:    string
          address:    string | null
          phone:      string | null
          is_active:  boolean
          created_at: string
          updated_at: string
          created_by: string | null
          updated_by: string | null
          is_deleted: boolean
        }
        Insert: {
          id?:        string
          tenant_id:  string
          name:       string
          name_ar:    string
          address?:   string | null
          phone?:     string | null
          is_active?: boolean
          created_by?: string | null
        }
        Update: {
          name?:      string
          name_ar?:   string
          address?:   string | null
          phone?:     string | null
          is_active?: boolean
          updated_by?: string | null
          is_deleted?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "branches_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          }
        ]
      }
      fiscal_years: {
        Row: {
          id:         string
          tenant_id:  string
          name:       string
          start_date: string
          end_date:   string
          is_closed:  boolean
          created_at: string
          updated_at: string
          created_by: string | null
          updated_by: string | null
        }
        Insert: {
          id?:        string
          tenant_id:  string
          name:       string
          start_date: string
          end_date:   string
          is_closed?: boolean
          created_by?: string | null
        }
        Update: {
          name?:      string
          is_closed?: boolean
          updated_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fiscal_years_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          }
        ]
      }
      audit_log: {
        Row: {
          id:          string
          tenant_id:   string
          user_id:     string | null
          action:      string
          entity_type: string
          entity_id:   string | null
          old_value:   Json | null
          new_value:   Json | null
          ip_address:  string | null
          created_at:  string
        }
        Insert: {
          id?:         string
          tenant_id:   string
          user_id?:    string | null
          action:      string
          entity_type: string
          entity_id?:  string | null
          old_value?:  Json | null
          new_value?:  Json | null
          ip_address?: string | null
        }
        Update: Record<string, never>
        Relationships: [
          {
            foreignKeyName: "audit_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          }
        ]
      }
    }
    Views: Record<string, never>
    Functions: {
      auth_tenant_id: {
        Args: Record<string, never>
        Returns: string
      }
      auth_role: {
        Args: Record<string, never>
        Returns: string
      }
      auth_has_permission: {
        Args: { p_permission: string }
        Returns: boolean
      }
      custom_access_token_hook: {
        Args: { event: Json }
        Returns: Json
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          email: string
          name: string | null
          is_admin: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          email: string
          name?: string | null
          is_admin?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          email?: string
          name?: string | null
          is_admin?: boolean
          updated_at?: string
        }
      }
      therapy_sessions: {
        Row: {
          id: string
          user_id: string
          exercise_type: string
          started_at: string
          completed_at: string | null
          duration_seconds: number | null
          target_reps: number
          completed_reps: number
          form_quality_score: number | null
          notes: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          exercise_type?: string
          started_at: string
          completed_at?: string | null
          duration_seconds?: number | null
          target_reps?: number
          completed_reps?: number
          form_quality_score?: number | null
          notes?: string | null
          created_at?: string
        }
        Update: {
          completed_at?: string | null
          duration_seconds?: number | null
          completed_reps?: number
          form_quality_score?: number | null
          notes?: string | null
        }
      }
      rep_data: {
        Row: {
          id: string
          session_id: string
          rep_number: number
          hold_duration_ms: number
          form_score: number
          timestamp: string
          created_at: string
        }
        Insert: {
          id?: string
          session_id: string
          rep_number: number
          hold_duration_ms: number
          form_score: number
          timestamp: string
          created_at?: string
        }
        Update: {
          form_score?: number
        }
      }
    }
  }
}

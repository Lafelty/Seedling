// Hand-maintained schema types (no Supabase CLI in this environment). Mirrors
// the SQL under supabase/migrations/*.sql, applied in filename order (see
// supabase/README.md for the deploy-order rule and migration index). JSONB
// columns are typed to the real shapes the app stores, not `Json`, so queries
// are checked end to end. Keep in sync when a migration adds/changes a column.

import type { Pose, PoseCriteria, TrackingMode } from '@/lib/poseDetection';

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

/** feedback_messages JSONB: keyed by failure kind (perfect/tooLow/…). */
export type FeedbackMessages = Record<string, string>;

/** One frame of a recorded demonstration. */
export interface RecordedFrame {
  timestamp: number;
  pose: Pose;
}

/** recorded_paths JSONB: one entry per recorded demonstration. */
export interface RecordedDemo {
  id?: string;
  frames: RecordedFrame[];
  duration?: number;
  recordedAt?: string;
}

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          name: string | null;
          is_admin: boolean;
          total_stars: number;
          height_cm: number | null;
          weight_kg: number | null;
          guardian_email: string | null;
          guardian_notify: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          name?: string | null;
          is_admin?: boolean;
          total_stars?: number;
          height_cm?: number | null;
          weight_kg?: number | null;
          guardian_email?: string | null;
          guardian_notify?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          email?: string;
          name?: string | null;
          total_stars?: number;
          height_cm?: number | null;
          weight_kg?: number | null;
          guardian_email?: string | null;
          guardian_notify?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      therapy_sessions: {
        Row: {
          id: string;
          user_id: string;
          exercise_id: string | null;
          exercise_type: string;
          started_at: string;
          completed_at: string | null;
          duration_seconds: number | null;
          target_reps: number;
          completed_reps: number;
          form_quality_score: number | null;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          exercise_id?: string | null;
          exercise_type?: string;
          started_at: string;
          completed_at?: string | null;
          duration_seconds?: number | null;
          target_reps?: number;
          completed_reps?: number;
          form_quality_score?: number | null;
          notes?: string | null;
          created_at?: string;
        };
        Update: {
          completed_at?: string | null;
          duration_seconds?: number | null;
          completed_reps?: number;
          form_quality_score?: number | null;
          notes?: string | null;
        };
        Relationships: [];
      };
      rep_data: {
        Row: {
          id: string;
          session_id: string;
          rep_number: number;
          hold_duration_ms: number;
          form_score: number;
          timestamp: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          session_id: string;
          rep_number: number;
          hold_duration_ms: number;
          form_score: number;
          timestamp: string;
          created_at?: string;
        };
        Update: {
          form_score?: number;
        };
        Relationships: [];
      };
      exercises: {
        Row: {
          id: string;
          name: string;
          description: string | null;
          exercise_type: string;
          difficulty: string | null;
          recorded_paths: RecordedDemo[] | null;
          pose_criteria: PoseCriteria;
          target_reps: number | null;
          hold_duration_ms: number | null;
          feedback_messages: FeedbackMessages | null;
          reference_image_url: string | null;
          reference_video_url: string | null;
          demo_images: string[];
          tracking_mode: TrackingMode;
          group_id: string | null;
          rank_in_group: number;
          unlock_min_score: number;
          unlock_max_seconds: number | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
          is_active: boolean;
        };
        Insert: {
          id?: string;
          name: string;
          description?: string | null;
          exercise_type: string;
          difficulty?: string | null;
          recorded_paths?: RecordedDemo[] | null;
          pose_criteria: PoseCriteria;
          target_reps?: number | null;
          hold_duration_ms?: number | null;
          feedback_messages?: FeedbackMessages | null;
          reference_image_url?: string | null;
          reference_video_url?: string | null;
          demo_images?: string[];
          tracking_mode?: TrackingMode;
          group_id?: string | null;
          rank_in_group?: number;
          unlock_min_score?: number;
          unlock_max_seconds?: number | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
          is_active?: boolean;
        };
        Update: Partial<Database['public']['Tables']['exercises']['Insert']>;
        Relationships: [];
      };
      exercise_groups: {
        Row: {
          id: string;
          name: string;
          description: string | null;
          sort_order: number;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          description?: string | null;
          sort_order?: number;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
          description?: string | null;
          sort_order?: number;
          is_active?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      is_admin: { Args: Record<string, never>; Returns: boolean };
      award_stars: { Args: { star_count?: number }; Returns: number };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

// ---- Row aliases for convenient imports across the app ----
export type ProfileRow = Database['public']['Tables']['profiles']['Row'];

/** Columns the admin/starconfig pages select when listing patients. */
export type ProfileSummary = Pick<
  ProfileRow,
  'id' | 'email' | 'name' | 'total_stars' | 'is_admin' | 'created_at'
>;
export type TherapySessionRow = Database['public']['Tables']['therapy_sessions']['Row'];
export type RepDataRow = Database['public']['Tables']['rep_data']['Row'];
export type ExerciseRow = Database['public']['Tables']['exercises']['Row'];
export type ExerciseGroupRow = Database['public']['Tables']['exercise_groups']['Row'];

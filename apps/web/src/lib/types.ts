export type Team = {
  id: string;
  name: string;
  created_at: string;
  owner_user_id: string;
};

export type TeamMember = {
  id: string;
  team_id: string;
  user_id: string;
  role: "admin" | "operator" | "viewer";
  joined_at: string;
  seat_active: boolean;
};

export type Subscription = {
  id: string;
  team_id: string;
  stripe_subscription_id: string | null;
  plan_name: string;
  status: string;
  seats_allowed: number;
  current_period_end: string | null;
  created_at: string;
  updated_at: string;
};

export type Session = {
  user: {
    id: string;
    email?: string | null;
  };
};

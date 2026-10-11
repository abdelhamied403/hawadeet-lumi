import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Tabs } from "expo-router";
import { getOverview } from "@/services/veogen";

const ICONS = { index: "film", posts: "message-square", series: "book-open", settings: "sliders" } as const;
const TITLES = { index: "Desk", posts: "Posts", series: "Series", settings: "Settings" } as const;

export default function TabsLayout() {
  // Shares the Desk's query, so the count costs no extra request.
  const { data } = useQuery({ queryKey: ["overview"], queryFn: getOverview, refetchInterval: 8000 });
  const drafts = data?.draftPosts ?? 0;

  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        title: TITLES[route.name as keyof typeof TITLES],
        sceneStyle: { backgroundColor: "#0f1a1e" },
        tabBarStyle: { backgroundColor: "#0a1215", borderTopColor: "#2b4048" },
        tabBarActiveTintColor: "#e9a23b",
        tabBarInactiveTintColor: "#8da3a1",
        tabBarLabelStyle: { fontFamily: "IBMPlexSans_500Medium", fontSize: 12 },
        tabBarBadge: route.name === "posts" && drafts > 0 ? drafts : undefined,
        tabBarBadgeStyle: { backgroundColor: "#e9a23b", color: "#1a1304", fontFamily: "IBMPlexMono_400Regular", fontSize: 11 },
        tabBarIcon: ({ color, size }) => <Feather name={ICONS[route.name as keyof typeof ICONS]} size={size} color={color} />,
      })}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="posts" />
      <Tabs.Screen name="series" />
      <Tabs.Screen name="settings" />
    </Tabs>
  );
}

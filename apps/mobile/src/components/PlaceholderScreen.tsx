/** Reusable, accessible placeholder for product areas outside the first milestone. */
import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radii, spacing, typeScale } from '../theme/tokens';

type PlaceholderScreenProps = {
  title: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
};

export function PlaceholderScreen({
  title,
  description,
  icon,
}: PlaceholderScreenProps) {
  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <View style={styles.content}>
        <View style={styles.iconCircle}>
          <Ionicons color={colors.ink} name={icon} size={34} />
        </View>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.description}>{description}</Text>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>功能建设中</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: colors.canvas,
    flex: 1,
  },
  content: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  iconCircle: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radii.round,
    height: 76,
    justifyContent: 'center',
    marginBottom: spacing.lg,
    width: 76,
  },
  title: {
    color: colors.ink,
    fontSize: 28,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  description: {
    color: colors.secondary,
    fontSize: typeScale.body,
    lineHeight: 24,
    maxWidth: 310,
    textAlign: 'center',
  },
  badge: {
    backgroundColor: colors.successSurface,
    borderRadius: radii.round,
    marginTop: spacing.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  badgeText: {
    color: colors.success,
    fontSize: typeScale.caption,
    fontWeight: '700',
  },
});

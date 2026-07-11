/**
 * Simple enemy patrol AI snippet for Phaser 3 Arcade physics.
 *
 * The sprite is expected to be a Phaser Physics Arcade sprite with
 * setVelocityX and an x position.
 */
export function createEnemyPatrolAI(
  sprite: {
    setVelocityX: (value: number) => void;
    x: number;
  },
  startX: number,
  endX: number,
  speed = 100,
) {
  let direction = 1;

  return {
    update(): void {
      sprite.setVelocityX(direction * speed);

      if (sprite.x >= endX) {
        direction = -1;
      } else if (sprite.x <= startX) {
        direction = 1;
      }
    },
  };
}

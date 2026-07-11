/**
 * Simple 2D player controller snippet for Phaser 3 Arcade physics.
 *
 * The sprite is expected to be a Phaser Physics Arcade sprite with
 * setVelocityX/setVelocityY methods.
 */
export function createPlayerController2D(sprite: {
  setVelocityX: (value: number) => void;
  setVelocityY: (value: number) => void;
  scene: {
    input: {
      keyboard: {
        createCursorKeys: () => {
          left: { isDown: boolean };
          right: { isDown: boolean };
          up: { isDown: boolean };
          down: { isDown: boolean };
        };
      };
    };
  };
}) {
  const cursors = sprite.scene.input.keyboard.createCursorKeys();
  const speed = 200;

  return {
    update(): void {
      sprite.setVelocityX(0);
      sprite.setVelocityY(0);

      if (cursors.left.isDown) sprite.setVelocityX(-speed);
      if (cursors.right.isDown) sprite.setVelocityX(speed);
      if (cursors.up.isDown) sprite.setVelocityY(-speed);
      if (cursors.down.isDown) sprite.setVelocityY(speed);
    },
  };
}

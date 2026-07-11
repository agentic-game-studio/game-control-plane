extends CharacterBody2D

@export var start_x: float = 0.0
@export var end_x: float = 100.0
@export var speed: float = 100.0

var direction: int = 1

func _physics_process(_delta: float) -> void:
	velocity.x = direction * speed
	move_and_slide()

	if global_position.x >= end_x:
		direction = -1
	elif global_position.x <= start_x:
		direction = 1

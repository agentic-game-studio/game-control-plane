using UnityEngine;

[RequireComponent(typeof(Rigidbody2D))]
public class EnemyAIPatrol : MonoBehaviour
{
    public float startX = 0f;
    public float endX = 10f;
    public float speed = 3f;

    private int direction = 1;
    private Rigidbody2D rb;

    void Start()
    {
        rb = GetComponent<Rigidbody2D>();
    }

    void FixedUpdate()
    {
        rb.velocity = new Vector2(direction * speed, rb.velocity.y);

        if (transform.position.x >= endX)
        {
            direction = -1;
        }
        else if (transform.position.x <= startX)
        {
            direction = 1;
        }
    }
}
